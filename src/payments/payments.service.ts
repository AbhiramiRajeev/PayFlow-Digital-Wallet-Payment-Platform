import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PaymentType, TransactionStatus, OutboxEventStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma.service';
import { WalletsService, toMinorUnits, fromMinorUnits } from '../wallets/wallets.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from './idempotency.service';
import { AddFundsInput, TransferFundsInput, ReverseTransferInput } from './payments.input';
import { PaymentResult, TransferResult } from './payments.model';
import { KafkaTopics } from '../kafka/kafka.events';

/**
 * PaymentsService handles all financial operations:
 * - Deposits (addFunds)
 * - Transfers between wallets (transferFunds)
 * - Reversals of transfers (reverseTransfer)
 *
 * Concurrency & Consistency Strategy:
 * ─────────────────────────────────────────────────────────────────────────────
 * All balance-modifying operations are wrapped in a serializable PostgreSQL
 * transaction with SELECT ... FOR UPDATE locking on wallet rows. This prevents:
 *
 * 1. Double spending: Two concurrent transfers from wallet A cannot both
 *    succeed if the combined amount exceeds the balance, because the second
 *    transaction blocks until the first commits, then reads the updated balance.
 *
 * 2. Phantom reads: The SERIALIZABLE isolation level prevents concurrent
 *    transactions from seeing inconsistent data.
 *
 * 3. Negative balances: Balance validation is done INSIDE the transaction
 *    AFTER acquiring the lock, ensuring no race conditions.
 *
 * Locking approach:
 * - We use `$executeRaw` with `SELECT ... FOR UPDATE` to lock wallet rows.
 * - We always lock wallets in a consistent order (smaller ID first) to
 *   prevent deadlocks when two transfers involve the same wallets.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly ledgerService: LedgerService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * Deposit funds into a wallet (simulated — no real payment gateway).
   *
   * Steps:
   * 1. Check idempotency key.
   * 2. Validate wallet ownership and status.
   * 3. Begin DB transaction.
   * 4. Lock wallet row (FOR UPDATE).
   * 5. Create Payment record (PENDING).
   * 6. Update wallet balance.
   * 7. Create LedgerTransaction with CREDIT entry.
   * 8. Write OutboxEvent for Kafka (atomic with transaction).
   * 9. Update Payment status to COMPLETED.
   * 10. Invalidate Redis balance cache.
   * 11. Store idempotency result.
   */
  async addFunds(userId: string, input: AddFundsInput): Promise<PaymentResult> {
    // Idempotency check
    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      const check = await this.idempotencyService.check(input.idempotencyKey, hash, 'addFunds');
      if (check.exists) return check.cachedResponse as PaymentResult;
    }

    // Validate ownership
    const wallet = await this.walletsService.assertOwnership(input.walletId, userId);
    this.walletsService.assertActive(wallet);

    const amountMinor = toMinorUnits(input.amount);

    // Execute within a PostgreSQL transaction
    const payment = await this.prisma.$transaction(
      async (tx) => {
        // Lock the wallet row to prevent concurrent modifications
        await tx.$executeRaw`
          SELECT id FROM wallets WHERE id = ${input.walletId} FOR UPDATE
        `;

        // Re-read wallet inside transaction for consistent balance
        const lockedWallet = await tx.wallet.findUnique({
          where: { id: input.walletId },
        });
        if (!lockedWallet) throw new NotFoundException('Wallet not found');

        // Create payment record (initially PENDING)
        const newPayment = await tx.payment.create({
          data: {
            walletId: input.walletId,
            type: PaymentType.DEPOSIT,
            status: TransactionStatus.PENDING,
            amount: amountMinor,
            currency: wallet.currency,
            description: input.description,
            idempotencyKey: input.idempotencyKey,
          },
        });

        // Update wallet balance atomically
        const newBalance = lockedWallet.balance + amountMinor;
        await tx.wallet.update({
          where: { id: input.walletId },
          data: { balance: newBalance },
        });

        // Create ledger entries (CREDIT to wallet)
        const ledgerData = this.ledgerService.buildDepositLedgerEntries({
          paymentId: newPayment.id,
          walletId: input.walletId,
          amount: amountMinor,
          balanceAfter: newBalance,
          description: input.description ?? `Deposit of ${input.amount} ${wallet.currency}`,
        });
        await tx.ledgerTransaction.create({ data: ledgerData });

        // Write outbox event (published atomically with this transaction)
        await tx.outboxEvent.create({
          data: {
            id: uuidv4(),
            topic: KafkaTopics.PAYMENT_COMPLETED,
            key: newPayment.id,
            payload: {
              eventId: uuidv4(),
              eventType: 'payment.completed',
              occurredAt: new Date().toISOString(),
              version: 1,
              payload: {
                paymentId: newPayment.id,
                walletId: input.walletId,
                amount: amountMinor.toString(),
                currency: wallet.currency,
              },
            },
            status: OutboxEventStatus.PENDING,
            paymentId: newPayment.id,
          },
        });

        // Mark payment as completed
        return tx.payment.update({
          where: { id: newPayment.id },
          data: { status: TransactionStatus.COMPLETED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Invalidate Redis balance cache AFTER transaction commits
    await this.walletsService.invalidateBalanceCache(input.walletId);

    this.logger.log(
      `Deposit completed: payment=${payment.id}, wallet=${input.walletId}, amount=${input.amount}`,
    );

    const result: PaymentResult = {
      id: payment.id,
      status: payment.status,
      type: payment.type,
      amount: fromMinorUnits(payment.amount),
      currency: payment.currency,
      description: payment.description ?? undefined,
      idempotencyKey: payment.idempotencyKey ?? undefined,
      createdAt: payment.createdAt,
    };

    // Store idempotency result for future retries
    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      await this.idempotencyService.store(
        input.idempotencyKey,
        hash,
        'addFunds',
        result as unknown as Prisma.InputJsonValue,
      );
    }

    return result;
  }

  /**
   * Transfer funds between two wallets.
   *
   * Steps:
   * 1. Check idempotency key.
   * 2. Validate both wallets exist, are active, and sender owns the source wallet.
   * 3. Validate sender has sufficient balance.
   * 4. Begin DB transaction.
   * 5. Lock both wallet rows in ID order to prevent deadlocks.
   * 6. Re-validate balance inside transaction (after lock).
   * 7. Create Transfer record (PENDING).
   * 8. Update both wallet balances atomically.
   * 9. Create balanced LedgerTransaction (DEBIT sender, CREDIT receiver).
   * 10. Write OutboxEvent.
   * 11. Update Transfer status to COMPLETED.
   * 12. Invalidate Redis caches.
   */
  async transferFunds(userId: string, input: TransferFundsInput): Promise<TransferResult> {
    if (input.senderWalletId === input.receiverWalletId) {
      throw new BadRequestException('Cannot transfer to the same wallet');
    }

    // Idempotency check
    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      const check = await this.idempotencyService.check(
        input.idempotencyKey,
        hash,
        'transferFunds',
      );
      if (check.exists) return check.cachedResponse as TransferResult;
    }

    // Validate sender wallet ownership
    const senderWallet = await this.walletsService.assertOwnership(input.senderWalletId, userId);
    this.walletsService.assertActive(senderWallet);

    // Validate receiver wallet exists and is active
    const receiverWallet = await this.walletsService.findWalletByIdOrThrow(input.receiverWalletId);
    this.walletsService.assertActive(receiverWallet);

    const amountMinor = toMinorUnits(input.amount);

    const transfer = await this.prisma.$transaction(
      async (tx) => {
        // Lock both wallets in consistent ID order to prevent deadlocks
        // (Smaller UUID comes first alphabetically)
        const [firstId, secondId] = [input.senderWalletId, input.receiverWalletId].sort();

        await tx.$executeRaw`
          SELECT id FROM wallets WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE
        `;

        // Re-read wallets inside the transaction for current balances
        const [lockedSender, lockedReceiver] = await Promise.all([
          tx.wallet.findUnique({ where: { id: input.senderWalletId } }),
          tx.wallet.findUnique({ where: { id: input.receiverWalletId } }),
        ]);

        if (!lockedSender) throw new NotFoundException('Sender wallet not found');
        if (!lockedReceiver) throw new NotFoundException('Receiver wallet not found');

        // Validate sufficient balance INSIDE the locked transaction
        if (lockedSender.balance < amountMinor) {
          throw new BadRequestException(
            `Insufficient balance. Available: ${fromMinorUnits(lockedSender.balance)} ${lockedSender.currency}, ` +
              `Requested: ${input.amount}`,
          );
        }

        // Create transfer record (initially PENDING)
        const newTransfer = await tx.transfer.create({
          data: {
            senderWalletId: input.senderWalletId,
            receiverWalletId: input.receiverWalletId,
            status: TransactionStatus.PENDING,
            amount: amountMinor,
            currency: senderWallet.currency,
            description: input.description,
            idempotencyKey: input.idempotencyKey,
          },
        });

        // Update both wallet balances in one round-trip
        const senderNewBalance = lockedSender.balance - amountMinor;
        const receiverNewBalance = lockedReceiver.balance + amountMinor;

        await Promise.all([
          tx.wallet.update({
            where: { id: input.senderWalletId },
            data: { balance: senderNewBalance },
          }),
          tx.wallet.update({
            where: { id: input.receiverWalletId },
            data: { balance: receiverNewBalance },
          }),
        ]);

        // Create balanced double-entry ledger (DEBIT sender, CREDIT receiver)
        const ledgerData = this.ledgerService.buildTransferLedgerEntries({
          transferId: newTransfer.id,
          debitWalletId: input.senderWalletId,
          creditWalletId: input.receiverWalletId,
          amount: amountMinor,
          debitBalanceAfter: senderNewBalance,
          creditBalanceAfter: receiverNewBalance,
          description:
            input.description ??
            `Transfer of ${input.amount} ${senderWallet.currency} from ${input.senderWalletId} to ${input.receiverWalletId}`,
        });
        await tx.ledgerTransaction.create({ data: ledgerData });

        // Write outbox event (atomic with this transaction)
        await tx.outboxEvent.create({
          data: {
            id: uuidv4(),
            topic: KafkaTopics.TRANSFER_COMPLETED,
            key: newTransfer.id,
            payload: {
              eventId: uuidv4(),
              eventType: 'transfer.completed',
              occurredAt: new Date().toISOString(),
              version: 1,
              payload: {
                transferId: newTransfer.id,
                senderWalletId: input.senderWalletId,
                receiverWalletId: input.receiverWalletId,
                amount: amountMinor.toString(),
                currency: senderWallet.currency,
              },
            },
            status: OutboxEventStatus.PENDING,
            transferId: newTransfer.id,
          },
        });

        // Mark transfer as completed
        return tx.transfer.update({
          where: { id: newTransfer.id },
          data: { status: TransactionStatus.COMPLETED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Invalidate Redis caches for both wallets
    await Promise.all([
      this.walletsService.invalidateBalanceCache(input.senderWalletId),
      this.walletsService.invalidateBalanceCache(input.receiverWalletId),
    ]);

    this.logger.log(
      `Transfer completed: transfer=${transfer.id}, ` +
        `from=${input.senderWalletId} to=${input.receiverWalletId}, amount=${input.amount}`,
    );

    const result: TransferResult = {
      id: transfer.id,
      senderWalletId: transfer.senderWalletId,
      receiverWalletId: transfer.receiverWalletId,
      status: transfer.status,
      amount: fromMinorUnits(transfer.amount),
      currency: transfer.currency,
      description: transfer.description ?? undefined,
      idempotencyKey: transfer.idempotencyKey ?? undefined,
      createdAt: transfer.createdAt,
    };

    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      await this.idempotencyService.store(
        input.idempotencyKey,
        hash,
        'transferFunds',
        result as unknown as Prisma.InputJsonValue,
      );
    }

    return result;
  }

  /**
   * Reverse a completed transfer using a compensating transaction.
   *
   * Design:
   * - The original Transfer is never modified (immutability).
   * - A new Transfer record is created with type REVERSAL linking to the original.
   * - Balanced ledger entries are created in the opposite direction.
   * - Only COMPLETED transfers can be reversed.
   * - Only the sender of the original transfer can request a reversal.
   */
  async reverseTransfer(userId: string, input: ReverseTransferInput): Promise<TransferResult> {
    // Idempotency check
    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      const check = await this.idempotencyService.check(
        input.idempotencyKey,
        hash,
        'reverseTransfer',
      );
      if (check.exists) return check.cachedResponse as TransferResult;
    }

    const originalTransfer = await this.prisma.transfer.findUnique({
      where: { id: input.transferId },
    });

    if (!originalTransfer) {
      throw new NotFoundException(`Transfer ${input.transferId} not found`);
    }

    if (originalTransfer.status !== TransactionStatus.COMPLETED) {
      throw new BadRequestException(
        `Only COMPLETED transfers can be reversed. Current status: ${originalTransfer.status}`,
      );
    }

    // Only the original sender can request a reversal
    const senderWallet = await this.walletsService.findWalletByIdOrThrow(
      originalTransfer.senderWalletId,
    );
    if (senderWallet.userId !== userId) {
      throw new ForbiddenException('Only the sender of the original transfer can reverse it');
    }

    // Check if already reversed
    const existingReversal = await this.prisma.transfer.findUnique({
      where: { reversedTransferId: input.transferId },
    });
    if (existingReversal) {
      throw new BadRequestException(`Transfer ${input.transferId} has already been reversed`);
    }

    // Validate receiver wallet exists before entering the transaction
    await this.walletsService.findWalletByIdOrThrow(originalTransfer.receiverWalletId);

    const reversal = await this.prisma.$transaction(
      async (tx) => {
        const [firstId, secondId] = [
          originalTransfer.senderWalletId,
          originalTransfer.receiverWalletId,
        ].sort();

        await tx.$executeRaw`
          SELECT id FROM wallets WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE
        `;

        const [lockedSender, lockedReceiver] = await Promise.all([
          tx.wallet.findUnique({ where: { id: originalTransfer.senderWalletId } }),
          tx.wallet.findUnique({ where: { id: originalTransfer.receiverWalletId } }),
        ]);

        if (!lockedSender || !lockedReceiver) {
          throw new NotFoundException('Wallet not found during reversal');
        }

        // Validate receiver has sufficient balance for reversal
        if (lockedReceiver.balance < originalTransfer.amount) {
          throw new BadRequestException(
            'Receiver wallet has insufficient funds for reversal. ' +
              'The funds may have already been spent.',
          );
        }

        // Create the reversal transfer record
        const reversalTransfer = await tx.transfer.create({
          data: {
            senderWalletId: originalTransfer.receiverWalletId, // reversed direction
            receiverWalletId: originalTransfer.senderWalletId,
            status: TransactionStatus.PENDING,
            amount: originalTransfer.amount,
            currency: originalTransfer.currency,
            description: input.reason ?? `Reversal of transfer ${originalTransfer.id}`,
            idempotencyKey: input.idempotencyKey,
            reversedTransferId: originalTransfer.id,
          },
        });

        // Reverse the original transfer's wallet balance changes
        const senderNewBalance = lockedSender.balance + originalTransfer.amount; // sender receives funds back
        const receiverNewBalance = lockedReceiver.balance - originalTransfer.amount; // receiver returns funds

        await Promise.all([
          tx.wallet.update({
            where: { id: originalTransfer.senderWalletId },
            data: { balance: senderNewBalance },
          }),
          tx.wallet.update({
            where: { id: originalTransfer.receiverWalletId },
            data: { balance: receiverNewBalance },
          }),
        ]);

        // Mark original transfer as REVERSED
        await tx.transfer.update({
          where: { id: originalTransfer.id },
          data: { status: TransactionStatus.REVERSED },
        });

        // Create compensating ledger entries (DEBIT receiver, CREDIT original sender)
        const ledgerData = this.ledgerService.buildTransferLedgerEntries({
          transferId: reversalTransfer.id,
          debitWalletId: originalTransfer.receiverWalletId,
          creditWalletId: originalTransfer.senderWalletId,
          amount: originalTransfer.amount,
          debitBalanceAfter: receiverNewBalance,
          creditBalanceAfter: senderNewBalance,
          description: `Reversal of transfer ${originalTransfer.id}`,
        });
        await tx.ledgerTransaction.create({ data: ledgerData });

        // Write outbox event
        await tx.outboxEvent.create({
          data: {
            id: uuidv4(),
            topic: KafkaTopics.TRANSFER_REVERSED,
            key: reversalTransfer.id,
            payload: {
              eventId: uuidv4(),
              eventType: 'transfer.reversed',
              occurredAt: new Date().toISOString(),
              version: 1,
              payload: {
                originalTransferId: originalTransfer.id,
                reversalTransferId: reversalTransfer.id,
                senderWalletId: originalTransfer.senderWalletId,
                receiverWalletId: originalTransfer.receiverWalletId,
                amount: originalTransfer.amount.toString(),
                currency: originalTransfer.currency,
              },
            },
            status: OutboxEventStatus.PENDING,
            transferId: reversalTransfer.id,
          },
        });

        return tx.transfer.update({
          where: { id: reversalTransfer.id },
          data: { status: TransactionStatus.COMPLETED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await Promise.all([
      this.walletsService.invalidateBalanceCache(originalTransfer.senderWalletId),
      this.walletsService.invalidateBalanceCache(originalTransfer.receiverWalletId),
    ]);

    this.logger.log(`Transfer reversed: original=${originalTransfer.id}, reversal=${reversal.id}`);

    const result: TransferResult = {
      id: reversal.id,
      senderWalletId: reversal.senderWalletId,
      receiverWalletId: reversal.receiverWalletId,
      status: reversal.status,
      amount: fromMinorUnits(reversal.amount),
      currency: reversal.currency,
      description: reversal.description ?? undefined,
      idempotencyKey: reversal.idempotencyKey ?? undefined,
      createdAt: reversal.createdAt,
    };

    if (input.idempotencyKey) {
      const hash = this.idempotencyService.hashPayload(input);
      await this.idempotencyService.store(
        input.idempotencyKey,
        hash,
        'reverseTransfer',
        result as unknown as Prisma.InputJsonValue,
      );
    }

    return result;
  }
}
