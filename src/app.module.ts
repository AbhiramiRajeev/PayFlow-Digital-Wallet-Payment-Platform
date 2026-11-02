import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { CommonModule } from './common/common.module';
import { KafkaModule } from './kafka/kafka.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsModule } from './payments/payments.module';
import { TransactionsModule } from './transactions/transactions.module';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    // Configuration — loaded first so all other modules can access env vars
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Cron job support for outbox processor
    ScheduleModule.forRoot(),

    // GraphQL with code-first approach
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: process.env.NODE_ENV !== 'production',
      introspection: process.env.NODE_ENV !== 'production',
      context: ({ req }: { req: unknown }) => ({ req }),
      formatError: (error) => ({
        message: error.message,
        extensions: error.extensions,
      }),
    }),

    // Infrastructure
    CommonModule,
    KafkaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    WalletsModule,
    LedgerModule,
    TransactionsModule,
    PaymentsModule,
    NotificationsModule,
  ],
})
export class AppModule {}
