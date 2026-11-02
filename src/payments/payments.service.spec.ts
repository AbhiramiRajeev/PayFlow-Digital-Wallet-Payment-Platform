import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { WalletsService } from '../wallets/wallets.service';
import { LedgerService } from '../ledger/ledger.service';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from '../common/prisma.service';
import { PaymentType, TransactionStatus, WalletStatus } from '@prisma/client';

// ─── Mock data ───────────────────────────────────────────────────────────────

const walletA = {
  id: 'wallet-a',
  userId: 'user-1',
  currency: 'INR',
  balance: BigInt(50000), // ₹500
  status: WalletStatus.ACTIVE,
  label: 'Sender',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const walletB = {
  id: 'wallet-b',
  userId: 'user-2',
  currency: 'INR',
  balance: BigInt(20000), // ₹200
  status: WalletStatus.ACTIVE,
  label: 'Receiver',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const completedTransfer = {
  id: 'transfer-1',
  senderWalletId: 'wallet-a',
  receiverWalletId: 'wallet-b',
  status: TransactionStatus.COMPLETED,
  amount: BigInt(10000), // ₹100
  currency: 'INR',
  description: 'Test transfer',
  idempotencyKey: null,
  reversedTransferId: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Helpers to build transaction mock ───────────────────────────────────────

function buildTxMock(
  overrides?: Partial<{
    walletABalance: bigint;
    walletBBalance: bigint;
  }>,
) {
  const senderBal = overrides?.walletABalance ?? walletA.balance;
  const receiverBal = overrides?.walletBBalance ?? walletB.balance;

  return {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    wallet: {
      findUnique: jest.fn().mockImplementation(({ where: { id } }: { where: { id: string } }) => {
        if (id === 'wallet-a') return Promise.resolve({ ...walletA, balance: senderBal });
        if (id === 'wallet-b') return Promise.resolve({ ...walletB, balance: receiverBal });
        return Promise.resolve(null);
      }),
      update: jest
        .fn()
        .mockImplementation(
          ({ where: { id }, data }: { where: { id: string }; data: { balance: bigint } }) =>
            Promise.resolve({ id, balance: data.balance }),
        ),
    },
    payment: {
      create: jest.fn().mockResolvedValue({
        id: 'payment-1',
        walletId: 'wallet-a',
        type: PaymentType.DEPOSIT,
        status: TransactionStatus.PENDING,
        amount: BigInt(10000),
        currency: 'INR',
        description: null,
        idempotencyKey: null,
        reversedPaymentId: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve({
          id: 'payment-1',
          walletId: 'wallet-a',
          type: PaymentType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          amount: BigInt(10000),
          currency: 'INR',
          description: null,
          idempotencyKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as object),
        }),
      ),
    },
    transfer: {
      create: jest.fn().mockResolvedValue({
        id: 'transfer-new',
        senderWalletId: 'wallet-a',
        receiverWalletId: 'wallet-b',
        status: TransactionStatus.PENDING,
        amount: BigInt(10000),
        currency: 'INR',
        description: null,
        idempotencyKey: null,
        reversedTransferId: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve({
          id: 'transfer-new',
          senderWalletId: 'wallet-a',
          receiverWalletId: 'wallet-b',
          status: TransactionStatus.COMPLETED,
          amount: BigInt(10000),
          currency: 'INR',
          description: null,
          idempotencyKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as object),
        }),
      ),
    },
    ledgerTransaction: {
      create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    },
    outboxEvent: {
      create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: jest.Mocked<PrismaService>;
  let walletsService: jest.Mocked<WalletsService>;
  let idempotencyService: jest.Mocked<IdempotencyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn(),
            transfer: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: WalletsService,
          useValue: {
            assertOwnership: jest.fn(),
            assertActive: jest.fn(),
            findWalletByIdOrThrow: jest.fn(),
            invalidateBalanceCache: jest.fn(),
          },
        },
        {
          provide: LedgerService,
          useValue: {
            buildDepositLedgerEntries: jest.fn().mockReturnValue({}),
            buildTransferLedgerEntries: jest.fn().mockReturnValue({}),
            assertBalanced: jest.fn(),
          },
        },
        {
          provide: IdempotencyService,
          useValue: {
            hashPayload: jest.fn().mockReturnValue('hash-123'),
            check: jest.fn().mockResolvedValue({ exists: false }),
            store: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get(PrismaService);
    walletsService = module.get(WalletsService);
    idempotencyService = module.get(IdempotencyService);
  });

  describe('addFunds', () => {
    it('should deposit funds successfully', async () => {
      walletsService.assertOwnership.mockResolvedValue(walletA as never);
      walletsService.assertActive.mockReturnValue(undefined);

      const txMock = buildTxMock();
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      );

      const result = await service.addFunds('user-1', {
        walletId: 'wallet-a',
        amount: 100,
      });

      expect(result.status).toBe(TransactionStatus.COMPLETED);
      expect(result.amount).toBe(100);
      expect(walletsService.invalidateBalanceCache).toHaveBeenCalledWith('wallet-a');
    });

    it('should return cached response on duplicate idempotency key', async () => {
      const cachedResponse = { id: 'payment-cached', status: 'COMPLETED', amount: 100 };
      idempotencyService.check.mockResolvedValue({ exists: true, cachedResponse });

      const result = await service.addFunds('user-1', {
        walletId: 'wallet-a',
        amount: 100,
        idempotencyKey: 'ik-001',
      });

      expect(result).toEqual(cachedResponse);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('transferFunds', () => {
    it('should complete a transfer successfully', async () => {
      walletsService.assertOwnership.mockResolvedValue(walletA as never);
      walletsService.assertActive.mockReturnValue(undefined);
      walletsService.findWalletByIdOrThrow.mockResolvedValue(walletB as never);

      const txMock = buildTxMock();
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      );

      const result = await service.transferFunds('user-1', {
        senderWalletId: 'wallet-a',
        receiverWalletId: 'wallet-b',
        amount: 100,
      });

      expect(result.status).toBe(TransactionStatus.COMPLETED);
      expect(walletsService.invalidateBalanceCache).toHaveBeenCalledWith('wallet-a');
      expect(walletsService.invalidateBalanceCache).toHaveBeenCalledWith('wallet-b');
    });

    it('should reject transfer to same wallet', async () => {
      await expect(
        service.transferFunds('user-1', {
          senderWalletId: 'wallet-a',
          receiverWalletId: 'wallet-a',
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject transfer with insufficient balance', async () => {
      walletsService.assertOwnership.mockResolvedValue(walletA as never);
      walletsService.assertActive.mockReturnValue(undefined);
      walletsService.findWalletByIdOrThrow.mockResolvedValue(walletB as never);

      // Override wallet A to have only ₹50 balance
      const txMock = buildTxMock({ walletABalance: BigInt(5000) });
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      );

      await expect(
        service.transferFunds('user-1', {
          senderWalletId: 'wallet-a',
          receiverWalletId: 'wallet-b',
          amount: 200, // ₹200 > ₹50 available
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replay cached result for duplicate idempotency key', async () => {
      const cachedResponse = { id: 'transfer-cached', status: 'COMPLETED', amount: 100 };
      idempotencyService.check.mockResolvedValue({ exists: true, cachedResponse });

      const result = await service.transferFunds('user-1', {
        senderWalletId: 'wallet-a',
        receiverWalletId: 'wallet-b',
        amount: 100,
        idempotencyKey: 'ik-transfer-001',
      });

      expect(result).toEqual(cachedResponse);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('reverseTransfer', () => {
    it('should reverse a COMPLETED transfer', async () => {
      (prisma.transfer.findUnique as jest.Mock)
        .mockResolvedValueOnce(completedTransfer) // original transfer
        .mockResolvedValueOnce(null); // no existing reversal

      walletsService.findWalletByIdOrThrow
        .mockResolvedValueOnce(walletA as never) // sender wallet check
        .mockResolvedValueOnce(walletB as never); // receiver wallet

      const txMock = buildTxMock();
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      );

      const result = await service.reverseTransfer('user-1', {
        transferId: 'transfer-1',
      });

      expect(result.status).toBe(TransactionStatus.COMPLETED);
    });

    it('should throw NotFoundException for non-existent transfer', async () => {
      (prisma.transfer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reverseTransfer('user-1', { transferId: 'transfer-999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject reversal of non-COMPLETED transfer', async () => {
      (prisma.transfer.findUnique as jest.Mock).mockResolvedValue({
        ...completedTransfer,
        status: TransactionStatus.PENDING,
      });

      await expect(service.reverseTransfer('user-1', { transferId: 'transfer-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject reversal by non-owner', async () => {
      (prisma.transfer.findUnique as jest.Mock).mockResolvedValue(completedTransfer);
      walletsService.findWalletByIdOrThrow.mockResolvedValue({
        ...walletA,
        userId: 'user-other', // different user
      } as never);

      await expect(
        service.reverseTransfer('user-not-owner', { transferId: 'transfer-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject double reversal', async () => {
      (prisma.transfer.findUnique as jest.Mock)
        .mockResolvedValueOnce(completedTransfer) // original
        .mockResolvedValueOnce({ id: 'reversal-existing' }); // already reversed

      walletsService.findWalletByIdOrThrow.mockResolvedValue(walletA as never);

      await expect(service.reverseTransfer('user-1', { transferId: 'transfer-1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
