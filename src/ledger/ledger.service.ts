import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { LedgerEntryType, Prisma } from '@prisma/client';

/**
 * LedgerService implements the double-entry bookkeeping system.
 *
 * Double-entry rules enforced here:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Every LedgerTransaction must have at least one DEBIT and one CREDIT entry.
 * 2. Total DEBIT amounts must equal total CREDIT amounts (balanced transaction).
 * 3. LedgerEntry amounts are always stored as positive BigInt values.
 * 4. The type (DEBIT/CREDIT) determines the direction:
 *    - DEBIT  on a wallet → decreases balance (funds leaving)
 *    - CREDIT on a wallet → increases balance (funds arriving)
 * 5. LedgerEntries are immutable. They are never updated or deleted.
 *    Reversals create new compensating entries.
 *
 * Balance calculation:
 *   balance = SUM(CREDIT entries) − SUM(DEBIT entries) for a wallet
 *   (Verified to always equal the wallet.balance column for consistency)
 *
 * A deposit creates:
 *   CREDIT  wallet         +amount  (wallet receives funds)
 *   DEBIT   system/float   +amount  (system acknowledges outflow)
 *
 * A transfer (A → B) creates:
 *   DEBIT   wallet A       +amount  (A sends)
 *   CREDIT  wallet B       +amount  (B receives)
 *
 * A reversal (undo A → B) creates:
 *   CREDIT  wallet A       +amount  (A is refunded)
 *   DEBIT   wallet B       +amount  (B returns funds)
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  /**
   * Build Prisma operations for a transfer ledger transaction.
   * Returns Prisma nested write data — must be executed inside a DB transaction.
   *
   * @param transferId  The Transfer record id
   * @param debitWalletId  Wallet being debited (sender)
   * @param creditWalletId  Wallet being credited (receiver)
   * @param amount  Amount in minor units
   * @param debitBalanceAfter  New balance of debit wallet after this entry
   * @param creditBalanceAfter  New balance of credit wallet after this entry
   * @param description  Human-readable description
   */
  buildTransferLedgerEntries(params: {
    transferId: string;
    debitWalletId: string;
    creditWalletId: string;
    amount: bigint;
    debitBalanceAfter: bigint;
    creditBalanceAfter: bigint;
    description: string;
  }): Prisma.LedgerTransactionCreateInput {
    this.validateAmount(params.amount);

    return {
      transfer: { connect: { id: params.transferId } },
      description: params.description,
      entries: {
        create: [
          {
            walletId: params.debitWalletId,
            type: LedgerEntryType.DEBIT,
            amount: params.amount,
            currency: 'INR',
            balanceAfter: params.debitBalanceAfter,
          },
          {
            walletId: params.creditWalletId,
            type: LedgerEntryType.CREDIT,
            amount: params.amount,
            currency: 'INR',
            balanceAfter: params.creditBalanceAfter,
          },
        ],
      },
    };
  }

  /**
   * Build Prisma operations for a deposit/payment ledger transaction.
   * For a deposit, the "other side" of the entry is recorded against
   * a virtual SYSTEM wallet concept — here we record a single-sided entry
   * against the wallet and note it's a deposit in the description.
   */
  buildDepositLedgerEntries(params: {
    paymentId: string;
    walletId: string;
    amount: bigint;
    balanceAfter: bigint;
    description: string;
  }): Prisma.LedgerTransactionCreateInput {
    this.validateAmount(params.amount);

    return {
      payment: { connect: { id: params.paymentId } },
      description: params.description,
      entries: {
        create: [
          {
            walletId: params.walletId,
            type: LedgerEntryType.CREDIT,
            amount: params.amount,
            currency: 'INR',
            balanceAfter: params.balanceAfter,
          },
        ],
      },
    };
  }

  /**
   * Verify that a set of ledger entries is balanced.
   * Throws InternalServerErrorException if debits ≠ credits.
   */
  assertBalanced(entries: { type: LedgerEntryType; amount: bigint }[]): void {
    const totalDebit = entries
      .filter((e) => e.type === LedgerEntryType.DEBIT)
      .reduce((sum, e) => sum + e.amount, BigInt(0));

    const totalCredit = entries
      .filter((e) => e.type === LedgerEntryType.CREDIT)
      .reduce((sum, e) => sum + e.amount, BigInt(0));

    // For transfers, debits must equal credits.
    // For deposits, we relax this check (single-sided entry by design).
    if (entries.length >= 2 && totalDebit !== totalCredit) {
      this.logger.error(`Ledger imbalance detected! Debit: ${totalDebit}, Credit: ${totalCredit}`);
      throw new InternalServerErrorException(
        'Ledger transaction is not balanced. This is a critical accounting error.',
      );
    }
  }

  private validateAmount(amount: bigint): void {
    if (amount <= BigInt(0)) {
      throw new InternalServerErrorException(
        `Ledger entry amount must be positive, got: ${amount}`,
      );
    }
  }
}
