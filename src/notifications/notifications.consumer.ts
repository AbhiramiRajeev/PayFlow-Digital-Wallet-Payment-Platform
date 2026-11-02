import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, KafkaMessage } from 'kafkajs';
import { PrismaService } from '../common/prisma.service';
import { KafkaTopics } from '../kafka/kafka.events';
import {
  TransferCompletedEvent,
  TransferReversedEvent,
  PaymentCompletedEvent,
} from '../kafka/kafka.events';

/**
 * NotificationsConsumer listens to Kafka events and creates notification records.
 *
 * Idempotency:
 * - Consumers track processed event IDs in a Set (in-memory for simplicity).
 * - In production, this should be backed by Redis or a DB table.
 * - Before processing, check if eventId was already handled.
 * - If duplicate, skip processing but commit the offset normally.
 *
 * Delivery semantics: at-least-once (from Kafka).
 * Combined with idempotent consumer logic: effectively-once processing.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsConsumer.name);
  private consumer!: Consumer;
  private kafka!: Kafka;
  private readonly processedEventIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const brokers = this.configService
      .get<string>('KAFKA_BROKERS', 'localhost:29092')
      .split(',')
      .map((b) => b.trim());

    this.kafka = new Kafka({
      clientId: `${this.configService.get<string>('KAFKA_CLIENT_ID', 'payflow-app')}-notifications`,
      brokers,
    });

    this.consumer = this.kafka.consumer({
      groupId: `${this.configService.get<string>('KAFKA_GROUP_ID', 'payflow-consumers')}-notifications`,
    });

    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topics: [
          KafkaTopics.TRANSFER_COMPLETED,
          KafkaTopics.TRANSFER_REVERSED,
          KafkaTopics.PAYMENT_COMPLETED,
        ],
        fromBeginning: false,
      });

      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          await this.handleMessage(topic, message);
        },
      });

      this.logger.log('Notifications Kafka consumer connected and listening');
    } catch (err) {
      this.logger.error('Failed to connect notifications consumer', err);
      // Don't throw — app continues without real-time notifications
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.consumer?.disconnect();
      this.logger.log('Notifications Kafka consumer disconnected');
    } catch {
      // Ignore errors during shutdown
    }
  }

  private async handleMessage(topic: string, message: KafkaMessage): Promise<void> {
    if (!message.value) return;

    let event: { eventId?: string; eventType?: string; payload?: unknown };
    try {
      event = JSON.parse(message.value.toString()) as typeof event;
    } catch {
      this.logger.warn(`Failed to parse Kafka message on topic ${topic}`);
      return;
    }

    const eventId = event.eventId;
    if (!eventId) {
      this.logger.warn(`Received event without eventId on topic ${topic}`);
      return;
    }

    // Idempotency check — skip if already processed
    if (this.processedEventIds.has(eventId)) {
      this.logger.debug(`Skipping duplicate event: ${eventId}`);
      return;
    }

    try {
      await this.processEvent(
        topic,
        event as TransferCompletedEvent | TransferReversedEvent | PaymentCompletedEvent,
      );
      this.processedEventIds.add(eventId);

      // Prune old event IDs to prevent unbounded memory growth
      if (this.processedEventIds.size > 10_000) {
        const oldest = Array.from(this.processedEventIds).slice(0, 5_000);
        oldest.forEach((id) => this.processedEventIds.delete(id));
      }
    } catch (err) {
      this.logger.error(`Failed to process event ${eventId}: ${err}`);
      // Don't rethrow — Kafka will not retry automatically in run() mode
    }
  }

  private async processEvent(
    topic: string,
    event: TransferCompletedEvent | TransferReversedEvent | PaymentCompletedEvent,
  ): Promise<void> {
    switch (topic) {
      case KafkaTopics.TRANSFER_COMPLETED: {
        const e = event as TransferCompletedEvent;
        const { senderWalletId, receiverWalletId, amount, currency } = e.payload;

        // Notify sender
        const senderWallet = await this.prisma.wallet.findUnique({
          where: { id: senderWalletId },
          include: { user: true },
        });
        if (senderWallet) {
          await this.prisma.notification.create({
            data: {
              userId: senderWallet.userId,
              title: 'Transfer Sent',
              body: `You sent ${Number(amount) / 100} ${currency} from your wallet.`,
              metadata: { transferId: e.payload.transferId, topic },
            },
          });
        }

        // Notify receiver
        const receiverWallet = await this.prisma.wallet.findUnique({
          where: { id: receiverWalletId },
          include: { user: true },
        });
        if (receiverWallet) {
          await this.prisma.notification.create({
            data: {
              userId: receiverWallet.userId,
              title: 'Transfer Received',
              body: `You received ${Number(amount) / 100} ${currency} in your wallet.`,
              metadata: { transferId: e.payload.transferId, topic },
            },
          });
        }
        break;
      }

      case KafkaTopics.TRANSFER_REVERSED: {
        const e = event as TransferReversedEvent;
        const { senderWalletId, amount, currency } = e.payload;

        const senderWallet = await this.prisma.wallet.findUnique({
          where: { id: senderWalletId },
        });
        if (senderWallet) {
          await this.prisma.notification.create({
            data: {
              userId: senderWallet.userId,
              title: 'Transfer Reversed',
              body: `A transfer of ${Number(amount) / 100} ${currency} has been reversed.`,
              metadata: { transferId: e.payload.originalTransferId, topic },
            },
          });
        }
        break;
      }

      case KafkaTopics.PAYMENT_COMPLETED: {
        const e = event as PaymentCompletedEvent;
        const { walletId, amount, currency } = e.payload;

        const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
        if (wallet) {
          await this.prisma.notification.create({
            data: {
              userId: wallet.userId,
              title: 'Deposit Successful',
              body: `${Number(amount) / 100} ${currency} has been deposited to your wallet.`,
              metadata: { paymentId: e.payload.paymentId, topic },
            },
          });
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled topic: ${topic}`);
    }
  }
}
