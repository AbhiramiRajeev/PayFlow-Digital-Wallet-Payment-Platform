import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxEventStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../common/prisma.service';
import { KafkaProducerService } from './kafka-producer.service';

/**
 * OutboxProcessorService implements the Transactional Outbox Pattern.
 *
 * Design:
 * 1. Business operations write outbox events atomically with DB changes.
 * 2. This processor polls for PENDING events and publishes them to Kafka.
 * 3. On success, marks event as PUBLISHED.
 * 4. On failure, increments attempt count and re-queues.
 * 5. After MAX_RETRIES failures, marks event as FAILED and publishes to DLQ.
 *
 * Delivery guarantee: at-least-once delivery to Kafka.
 * Consumers must be idempotent.
 */
@Injectable()
export class OutboxProcessorService {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private readonly maxRetries: number;
  private readonly dltSuffix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    this.maxRetries = this.configService.get<number>('OUTBOX_MAX_RETRIES', 3);
    this.dltSuffix = this.configService.get<string>('KAFKA_DLT_SUFFIX', '.dlq');
  }

  /**
   * Polls the outbox table every 5 seconds and processes pending events.
   * The interval is configurable via OUTBOX_POLL_INTERVAL_MS.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    // Select pending events, limit to 100 per cycle to avoid memory pressure
    const pendingEvents = await this.prisma.outboxEvent.findMany({
      where: { status: OutboxEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    if (pendingEvents.length === 0) return;

    this.logger.debug(`Processing ${pendingEvents.length} outbox events`);

    for (const event of pendingEvents) {
      try {
        await this.kafkaProducer.send({
          topic: event.topic,
          messages: [
            {
              key: event.key ?? uuidv4(),
              value: JSON.stringify(event.payload),
              headers: {
                'event-id': event.id,
                'event-topic': event.topic,
              },
            },
          ],
        });

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: OutboxEventStatus.PUBLISHED,
            processedAt: new Date(),
          },
        });
      } catch (err) {
        const newAttempts = event.attempts + 1;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to publish outbox event ${event.id} (attempt ${newAttempts}): ${errorMessage}`,
        );

        if (newAttempts >= this.maxRetries) {
          // Send to dead-letter topic and mark as failed
          await this.sendToDlt(event.id, event.topic, event.payload, errorMessage);
        } else {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: newAttempts,
              lastError: errorMessage,
            },
          });
        }
      }
    }
  }

  private async sendToDlt(
    eventId: string,
    originalTopic: string,
    payload: unknown,
    errorMessage: string,
  ): Promise<void> {
    const dltTopic = `${originalTopic}${this.dltSuffix}`;
    try {
      await this.kafkaProducer.send({
        topic: dltTopic,
        messages: [
          {
            key: eventId,
            value: JSON.stringify({ originalPayload: payload, error: errorMessage }),
          },
        ],
      });

      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: {
          status: OutboxEventStatus.FAILED,
          lastError: errorMessage,
          attempts: this.maxRetries,
        },
      });

      this.logger.error(`Outbox event ${eventId} sent to DLT: ${dltTopic}`);
    } catch (dltErr) {
      this.logger.error(`Failed to send event ${eventId} to DLT: ${dltErr}`);
    }
  }
}
