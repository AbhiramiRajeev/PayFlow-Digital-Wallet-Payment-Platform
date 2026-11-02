import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { WalletsService, toMinorUnits, fromMinorUnits } from './wallets.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { ConfigService } from '@nestjs/config';
import { WalletStatus } from '@prisma/client';

const mockWallet = {
  id: 'wallet-1',
  userId: 'user-1',
  currency: 'INR',
  balance: BigInt(10000), // ₹100.00
  status: WalletStatus.ACTIVE,
  label: 'Default',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        {
          provide: PrismaService,
          useValue: {
            wallet: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            getJson: jest.fn(),
            setJson: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(300),
          },
        },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
  });

  describe('minor unit conversions', () => {
    it('converts ₹100.50 to 10050 paise', () => {
      expect(toMinorUnits(100.5)).toBe(BigInt(10050));
    });

    it('converts 10050 paise to ₹100.50', () => {
      expect(fromMinorUnits(BigInt(10050))).toBe(100.5);
    });

    it('handles zero correctly', () => {
      expect(toMinorUnits(0)).toBe(BigInt(0));
      expect(fromMinorUnits(BigInt(0))).toBe(0);
    });

    it('rounds floating point correctly (₹100.001 → 10000)', () => {
      expect(toMinorUnits(100.001)).toBe(BigInt(10000));
    });
  });

  describe('createWallet', () => {
    it('creates a wallet for a user', async () => {
      (prisma.wallet.create as jest.Mock).mockResolvedValue(mockWallet);

      const result = await service.createWallet('user-1', 'INR', 'Default');

      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', currency: 'INR', label: 'Default' },
      });
      expect(result.id).toBe('wallet-1');
    });
  });

  describe('findWalletByIdOrThrow', () => {
    it('returns wallet when found', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      const result = await service.findWalletByIdOrThrow('wallet-1');
      expect(result.id).toBe('wallet-1');
    });

    it('throws NotFoundException when wallet not found', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findWalletByIdOrThrow('wallet-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBalance', () => {
    it('returns cached balance from Redis when available', async () => {
      (redis.get as jest.Mock).mockResolvedValue('10000');

      const result = await service.getBalance('wallet-1');

      expect(result.balance).toBe(BigInt(10000));
      expect(result.fromCache).toBe(true);
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('falls through to PostgreSQL on cache miss', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: BigInt(10000) });

      const result = await service.getBalance('wallet-1');

      expect(result.balance).toBe(BigInt(10000));
      expect(result.fromCache).toBe(false);
      expect(prisma.wallet.findUnique).toHaveBeenCalled();
    });

    it('throws NotFoundException when wallet does not exist', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getBalance('wallet-999')).rejects.toThrow(NotFoundException);
    });

    it('falls through to PostgreSQL when Redis throws', async () => {
      (redis.get as jest.Mock).mockRejectedValue(new Error('Redis connection error'));
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: BigInt(5000) });

      const result = await service.getBalance('wallet-1');
      expect(result.balance).toBe(BigInt(5000));
      expect(result.fromCache).toBe(false);
    });
  });

  describe('assertOwnership', () => {
    it('returns wallet when user owns it', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      const result = await service.assertOwnership('wallet-1', 'user-1');
      expect(result.id).toBe('wallet-1');
    });

    it('throws ForbiddenException when user does not own wallet', async () => {
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      await expect(service.assertOwnership('wallet-1', 'user-other')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('assertActive', () => {
    it('does not throw for ACTIVE wallets', () => {
      expect(() => service.assertActive(mockWallet as never)).not.toThrow();
    });

    it('throws BadRequestException for SUSPENDED wallet', () => {
      const suspended = { ...mockWallet, status: WalletStatus.SUSPENDED };
      expect(() => service.assertActive(suspended as never)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for CLOSED wallet', () => {
      const closed = { ...mockWallet, status: WalletStatus.CLOSED };
      expect(() => service.assertActive(closed as never)).toThrow(BadRequestException);
    });
  });
});
