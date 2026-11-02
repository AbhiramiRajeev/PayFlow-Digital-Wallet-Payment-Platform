import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord, RecordMetadata, KafkaConfig } from 'kafkajs';

/**
 * KafkaProducerService manages a singleton Kafka producer.
 *
 * IMPORTANT: This producer is used ONLY by the OutboxProcessorService.
 * Application code must never call this producer directly — events must be
 * written to the outbox table within the same DB transaction as the business
 * operation, and the outbox processor publishes them asynchronously.
 *
 * This ensures we never lose events between a DB commit and Kafka publish.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer!: Producer;
  private kafka!: Kafka;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const brokers = this.configService
      .get<string>('KAFKA_BROKERS', 'localhost:29092')
      .split(',')
      .map((b) => b.trim());

    const config: KafkaConfig = {
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID', 'payflow-app'),
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    };

    this.kafka = new Kafka(config);
    this.producer = this.kafka.producer({
      // Enable idempotent producer for exactly-once semantics
      idempotent: true,
      transactionTimeout: 30000,
    });

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.error('Failed to connect Kafka producer', err);
      // Don't throw — allow app to start; outbox processor will retry
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      throw new Error('Kafka producer is not connected');
    }
    return this.producer.send(record);
  }

  async sendBatch(records: ProducerRecord[]): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka producer is not connected');
    }
    await this.producer.sendBatch({
      topicMessages: records.map((r) => ({
        topic: r.topic,
        messages: r.messages,
      })),
    });
  }
}
