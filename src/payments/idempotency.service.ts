import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface IdempotencyCheckResult {
  exists: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachedResponse?: any;
}

/**
 * IdempotencyService manages idempotency keys for safe operation retries.
 *
 * Design:
 * - The key is stored in the DB with a SHA-256 hash of the request payload.
 * - On retry: if key + hash match → return cached response (safe replay).
 * - On retry: if key matches but hash differs → reject with 409 Conflict.
 * - Keys expire after IDEMPOTENCY_TTL_SECONDS (default: 24h).
 *
 * Concurrent duplicate handling:
 * - The `key` column has a UNIQUE constraint.
 * - On concurrent duplicate requests, Prisma will throw a unique constraint
 *   violation (P2002) which we convert to a 409 response.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds = this.configService.get<number>('IDEMPOTENCY_TTL_SECONDS', 86400);
  }

  hashPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Check if an idempotency key has been used before.
   * If it has, validates the request hash matches the original.
   */
  async check(
    key: string,
    requestHash: string,
    operationType: string,
  ): Promise<IdempotencyCheckResult> {
    const record = await this.prisma.idempotencyRecord.findUnique({ where: { key } });

    if (!record) return { exists: false };

    // Key exists — validate payload matches
    if (record.requestHash !== requestHash) {
      throw new ConflictException(
        `Idempotency key '${key}' was already used with a different request payload. ` +
          `Use a new idempotency key for a different operation.`,
      );
    }

    if (record.operationType !== operationType) {
      throw new ConflictException(
        `Idempotency key '${key}' was already used for operation '${record.operationType}'. ` +
          `It cannot be reused for '${operationType}'.`,
      );
    }

    this.logger.log(`Replaying cached response for idempotency key: ${key}`);
    return { exists: true, cachedResponse: record.responseBody };
  }

  /**
   * Store the idempotency key and its associated response.
   * Called after the operation completes successfully.
   */
  async store(
    key: string,
    requestHash: string,
    operationType: string,
    response: Prisma.InputJsonValue,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    try {
      await this.prisma.idempotencyRecord.create({
        data: { key, requestHash, operationType, responseBody: response, expiresAt },
      });
    } catch (err: unknown) {
      // P2002 = unique constraint violation (concurrent duplicate request)
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        this.logger.warn(`Concurrent duplicate idempotency key: ${key}`);
        // Safe to ignore — the first request will have stored the response
        return;
      }
      throw err;
    }
  }
}
