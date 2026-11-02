import { Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { OutboxProcessorService } from './outbox-processor.service';

@Module({
  providers: [KafkaProducerService, OutboxProcessorService],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
