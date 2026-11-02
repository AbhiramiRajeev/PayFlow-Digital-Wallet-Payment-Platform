import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '@prisma/client';
import { WalletsService, fromMinorUnits } from './wallets.service';
import { WalletModel, WalletBalanceModel } from './wallet.model';
import { CreateWalletInput } from './wallet.input';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Resolver(() => WalletModel)
export class WalletsResolver {
  constructor(private readonly walletsService: WalletsService) {}

  @Query(() => [WalletModel], { description: 'Get all wallets belonging to the current user' })
  @UseGuards(JwtAuthGuard)
  async myWallets(@CurrentUser() user: User): Promise<WalletModel[]> {
    const wallets = await this.walletsService.findWalletsByUser(user.id);
    return wallets.map((w) => ({
      ...w,
      balance: fromMinorUnits(w.balance),
      label: w.label ?? undefined,
    }));
  }

  @Query(() => WalletBalanceModel, { description: 'Get the current balance of a wallet' })
  @UseGuards(JwtAuthGuard)
  async walletBalance(
    @Args('walletId', { type: () => ID }) walletId: string,
    @CurrentUser() user: User,
  ): Promise<WalletBalanceModel> {
    // Verify ownership before exposing balance
    await this.walletsService.assertOwnership(walletId, user.id);
    const { balance, fromCache } = await this.walletsService.getBalance(walletId);

    return {
      walletId,
      currency: 'INR', // TODO: read from wallet record if multi-currency
      balance: fromMinorUnits(balance),
      cachedAt: fromCache ? new Date() : new Date(),
    };
  }

  @Mutation(() => WalletModel, { description: 'Create an additional wallet for the current user' })
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createWallet(
    @Args('input') input: CreateWalletInput,
    @CurrentUser() user: User,
  ): Promise<WalletModel> {
    const wallet = await this.walletsService.createWallet(
      user.id,
      input.currency ?? 'INR',
      input.label,
    );
    return { ...wallet, balance: fromMinorUnits(wallet.balance), label: wallet.label ?? undefined };
  }
}
