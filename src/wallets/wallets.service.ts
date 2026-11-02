import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Wallet, WalletStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

// Minor-unit conversion helpers
// These prevent any floating-point arithmetic on financial values.
export const toMinorUnits = (amount: number): bigint => BigInt(Math.round(amount * 100));

export const fromMinorUnits = (amount: bigint): number => Number(amount) / 100;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);
  private readonly balanceTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.balanceTtl = this.configService.get<number>('REDIS_WALLET_BALANCE_TTL', 300);
  }

  /** Create a new wallet for a user. */
  async createWallet(userId: string, currency = 'INR', label?: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.create({
      data: { userId, currency, label },
    });
    this.logger.log(`Wallet ${wallet.id} created for user ${userId}`);
    return wallet;
  }

  /** Find all wallets belonging to a user. */
  async findWalletsByUser(userId: string): Promise<Wallet[]> {
    return this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Find a single wallet by ID. */
  async findWalletById(walletId: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { id: walletId } });
  }

  /** Find a wallet by ID, throwing if not found. */
  async findWalletByIdOrThrow(walletId: string): Promise<Wallet> {
    const wallet = await this.findWalletById(walletId);
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);
    return wallet;
  }

  /**
   * Get the wallet balance.
   *
   * Cache strategy:
   * - Check Redis for a cached balance value (TTL: 5 min by default).
   * - On cache miss, read from PostgreSQL and populate the cache.
   * - Cache is invalidated on every successful transaction.
   *
   * Redis is never the source of truth. If Redis is unavailable,
   * we fall through to PostgreSQL silently.
   */
  async getBalance(walletId: string): Promise<{ balance: bigint; fromCache: boolean }> {
    const cacheKey = `wallet:balance:${walletId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return { balance: BigInt(cached), fromCache: true };
      }
    } catch (err) {
      this.logger.warn(`Redis unavailable for wallet ${walletId}: ${err}`);
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { balance: true },
    });

    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);

    try {
      await this.redis.set(cacheKey, wallet.balance.toString(), this.balanceTtl);
    } catch {
      // Non-fatal — cache population is best-effort
    }

    return { balance: wallet.balance, fromCache: false };
  }

  /** Invalidate the cached balance after a transaction. */
  async invalidateBalanceCache(walletId: string): Promise<void> {
    try {
      await this.redis.del(`wallet:balance:${walletId}`);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Verify the user owns the wallet.
   * Throws ForbiddenException if not.
   */
  async assertOwnership(walletId: string, userId: string): Promise<Wallet> {
    const wallet = await this.findWalletByIdOrThrow(walletId);
    if (wallet.userId !== userId) {
      throw new ForbiddenException('You do not own this wallet');
    }
    return wallet;
  }

  /**
   * Assert the wallet is ACTIVE and throw with a descriptive message if not.
   */
  assertActive(wallet: Wallet): void {
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(
        `Wallet ${wallet.id} is ${wallet.status.toLowerCase()} and cannot process transactions`,
      );
    }
  }
}
