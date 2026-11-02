import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from '../common/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: PrismaService,
          useValue: {
            idempotencyRecord: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(86400),
          },
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    prisma = module.get(PrismaService);
  });

  describe('hashPayload', () => {
    it('produces consistent hashes for the same payload', () => {
      const payload = { walletId: 'w1', amount: 100 };
      expect(service.hashPayload(payload)).toBe(service.hashPayload(payload));
    });

    it('produces different hashes for different payloads', () => {
      expect(service.hashPayload({ amount: 100 })).not.toBe(service.hashPayload({ amount: 200 }));
    });
  });

  describe('check', () => {
    it('returns { exists: false } for a new key', async () => {
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.check('new-key', 'hash-abc', 'addFunds');
      expect(result.exists).toBe(false);
    });

    it('returns cached response for matching key + hash', async () => {
      const cachedResponse = { id: 'payment-1', status: 'COMPLETED' };
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'ik-1',
        requestHash: 'hash-abc',
        operationType: 'addFunds',
        responseBody: cachedResponse,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const result = await service.check('ik-1', 'hash-abc', 'addFunds');
      expect(result.exists).toBe(true);
      expect(result.cachedResponse).toEqual(cachedResponse);
    });

    it('throws ConflictException for same key with different payload', async () => {
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'ik-1',
        requestHash: 'original-hash',
        operationType: 'addFunds',
        responseBody: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
      });

      await expect(service.check('ik-1', 'different-hash', 'addFunds')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException for same key with different operation', async () => {
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'ik-1',
        requestHash: 'hash-abc',
        operationType: 'addFunds',
        responseBody: {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
      });

      await expect(service.check('ik-1', 'hash-abc', 'transferFunds')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('store', () => {
    it('stores idempotency record successfully', async () => {
      (prisma.idempotencyRecord.create as jest.Mock).mockResolvedValue({});

      await expect(
        service.store('ik-new', 'hash-xyz', 'addFunds', { id: 'payment-1' }),
      ).resolves.not.toThrow();

      expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: 'ik-new',
            requestHash: 'hash-xyz',
            operationType: 'addFunds',
          }),
        }),
      );
    });

    it('silently handles concurrent duplicate (P2002 error)', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      (prisma.idempotencyRecord.create as jest.Mock).mockRejectedValue(p2002Error);

      // Should not throw for concurrent duplicate
      await expect(service.store('ik-dup', 'hash-dup', 'addFunds', {})).resolves.not.toThrow();
    });

    it('rethrows non-P2002 errors', async () => {
      const dbError = new Error('Database connection lost');
      (prisma.idempotencyRecord.create as jest.Mock).mockRejectedValue(dbError);

      await expect(service.store('ik-fail', 'hash-fail', 'addFunds', {})).rejects.toThrow(
        'Database connection lost',
      );
    });
  });
});
