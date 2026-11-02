import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletsService } from './wallets.service';
import { WalletsResolver } from './wallets.resolver';

@Module({
  imports: [ConfigModule],
  providers: [WalletsService, WalletsResolver],
  exports: [WalletsService],
})
export class WalletsModule {}
