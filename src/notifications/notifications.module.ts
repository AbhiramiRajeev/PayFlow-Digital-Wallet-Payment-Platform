import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsConsumer } from './notifications.consumer';

@Module({
  imports: [ConfigModule],
  providers: [NotificationsConsumer],
})
export class NotificationsModule {}
