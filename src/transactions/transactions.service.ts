import { Injectable } from '@nestjs/common';
import { Payment, Transfer } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { fromMinorUnits } from '../wallets/wallets.service';
import { TransactionModel, TransferModel, TransactionHistoryModel } from './transaction.model';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve combined transaction history for a given wallet.
   * Returns both Payment (deposits/reversals) and Transfer records,
   * ordered by creation date descending.
   */
  async getTransactionHistory(walletId: string, limit = 20): Promise<TransactionHistoryModel> {
    const [payments, transfers] = await Promise.all([
      this.prisma.payment.findMany({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.transfer.findMany({
        where: {
          OR: [{ senderWalletId: walletId }, { receiverWalletId: walletId }],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return {
      payments: payments.map(this.mapPayment),
      transfers: transfers.map(this.mapTransfer),
      total: payments.length + transfers.length,
    };
  }

  async getTransactionById(
    id: string,
  ): Promise<
    (TransactionModel & { _type: 'payment' }) | (TransferModel & { _type: 'transfer' }) | null
  > {
    const [payment, transfer] = await Promise.all([
      this.prisma.payment.findUnique({ where: { id } }),
      this.prisma.transfer.findUnique({ where: { id } }),
    ]);

    if (payment) return { ...this.mapPayment(payment), _type: 'payment' };
    if (transfer) return { ...this.mapTransfer(transfer), _type: 'transfer' };
    return null;
  }

  private mapPayment(p: Payment): TransactionModel {
    return {
      id: p.id,
      type: p.type,
      status: p.status,
      amount: fromMinorUnits(p.amount),
      currency: p.currency,
      description: p.description ?? undefined,
      idempotencyKey: p.idempotencyKey ?? undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private mapTransfer(t: Transfer): TransferModel {
    return {
      id: t.id,
      senderWalletId: t.senderWalletId,
      receiverWalletId: t.receiverWalletId,
      status: t.status,
      amount: fromMinorUnits(t.amount),
      currency: t.currency,
      description: t.description ?? undefined,
      idempotencyKey: t.idempotencyKey ?? undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
