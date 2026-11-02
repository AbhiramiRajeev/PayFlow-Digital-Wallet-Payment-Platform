import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsResolver } from './payments.resolver';
import { IdempotencyService } from './idempotency.service';
import { WalletsModule } from '../wallets/wallets.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [ConfigModule, WalletsModule, LedgerModule, TransactionsModule],
  providers: [PaymentsService, PaymentsResolver, IdempotencyService],
  exports: [PaymentsService, IdempotencyService],
})
export class PaymentsModule {}
