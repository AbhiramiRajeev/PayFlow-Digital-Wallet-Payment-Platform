import { InternalServerErrorException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerEntryType } from '@prisma/client';

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService();
  });

  describe('buildTransferLedgerEntries', () => {
    it('creates balanced DEBIT and CREDIT entries for a transfer', () => {
      const result = service.buildTransferLedgerEntries({
        transferId: 'transfer-1',
        debitWalletId: 'wallet-a',
        creditWalletId: 'wallet-b',
        amount: BigInt(10000),
        debitBalanceAfter: BigInt(40000),
        creditBalanceAfter: BigInt(30000),
        description: 'Test transfer',
      });

      // Should produce a LedgerTransaction with entries nested
      expect(result.transfer).toEqual({ connect: { id: 'transfer-1' } });
      expect(result.description).toBe('Test transfer');

      const entries = (
        result.entries as {
          create: Array<{
            walletId: string;
            type: LedgerEntryType;
            amount: bigint;
          }>;
        }
      ).create;

      expect(entries).toHaveLength(2);

      const debit = entries.find((e) => e.type === LedgerEntryType.DEBIT);
      const credit = entries.find((e) => e.type === LedgerEntryType.CREDIT);

      expect(debit?.walletId).toBe('wallet-a');
      expect(debit?.amount).toBe(BigInt(10000));
      expect(credit?.walletId).toBe('wallet-b');
      expect(credit?.amount).toBe(BigInt(10000));
    });

    it('throws for zero amount', () => {
      expect(() =>
        service.buildTransferLedgerEntries({
          transferId: 'transfer-1',
          debitWalletId: 'wallet-a',
          creditWalletId: 'wallet-b',
          amount: BigInt(0),
          debitBalanceAfter: BigInt(0),
          creditBalanceAfter: BigInt(0),
          description: 'Zero transfer',
        }),
      ).toThrow(InternalServerErrorException);
    });

    it('throws for negative amount', () => {
      expect(() =>
        service.buildTransferLedgerEntries({
          transferId: 'transfer-1',
          debitWalletId: 'wallet-a',
          creditWalletId: 'wallet-b',
          amount: BigInt(-100),
          debitBalanceAfter: BigInt(0),
          creditBalanceAfter: BigInt(0),
          description: 'Negative transfer',
        }),
      ).toThrow(InternalServerErrorException);
    });
  });

  describe('buildDepositLedgerEntries', () => {
    it('creates a CREDIT entry for a deposit', () => {
      const result = service.buildDepositLedgerEntries({
        paymentId: 'payment-1',
        walletId: 'wallet-a',
        amount: BigInt(10000),
        balanceAfter: BigInt(20000),
        description: 'Deposit ₹100',
      });

      expect(result.payment).toEqual({ connect: { id: 'payment-1' } });

      const entries = (
        result.entries as {
          create: Array<{
            walletId: string;
            type: LedgerEntryType;
            amount: bigint;
            balanceAfter: bigint;
          }>;
        }
      ).create;

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe(LedgerEntryType.CREDIT);
      expect(entries[0].walletId).toBe('wallet-a');
      expect(entries[0].amount).toBe(BigInt(10000));
      expect(entries[0].balanceAfter).toBe(BigInt(20000));
    });
  });

  describe('assertBalanced', () => {
    it('passes for balanced debit/credit entries', () => {
      expect(() =>
        service.assertBalanced([
          { type: LedgerEntryType.DEBIT, amount: BigInt(10000) },
          { type: LedgerEntryType.CREDIT, amount: BigInt(10000) },
        ]),
      ).not.toThrow();
    });

    it('throws InternalServerErrorException for unbalanced entries', () => {
      expect(() =>
        service.assertBalanced([
          { type: LedgerEntryType.DEBIT, amount: BigInt(10000) },
          { type: LedgerEntryType.CREDIT, amount: BigInt(9999) }, // off by 1
        ]),
      ).toThrow(InternalServerErrorException);
    });

    it('passes with single-entry (deposit scenario)', () => {
      expect(() =>
        service.assertBalanced([{ type: LedgerEntryType.CREDIT, amount: BigInt(10000) }]),
      ).not.toThrow();
    });

    it('passes for balanced multi-entry scenario', () => {
      expect(() =>
        service.assertBalanced([
          { type: LedgerEntryType.DEBIT, amount: BigInt(5000) },
          { type: LedgerEntryType.DEBIT, amount: BigInt(5000) },
          { type: LedgerEntryType.CREDIT, amount: BigInt(10000) },
        ]),
      ).not.toThrow();
    });
  });
});
