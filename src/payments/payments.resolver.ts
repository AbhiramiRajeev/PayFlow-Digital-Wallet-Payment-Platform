import { Resolver, Mutation, Query, Args, ID } from '@nestjs/graphql';
import { UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { User } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { TransactionsService } from '../transactions/transactions.service';
import { AddFundsInput, TransferFundsInput, ReverseTransferInput } from './payments.input';
import { PaymentResult, TransferResult } from './payments.model';
import { TransactionHistoryModel, TransactionModel } from '../transactions/transaction.model';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Resolver()
export class PaymentsResolver {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Mutation(() => PaymentResult, { description: 'Deposit funds into a wallet' })
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async addFunds(
    @Args('input') input: AddFundsInput,
    @CurrentUser() user: User,
  ): Promise<PaymentResult> {
    return this.paymentsService.addFunds(user.id, input);
  }

  @Mutation(() => TransferResult, { description: 'Transfer funds between two wallets' })
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async transferFunds(
    @Args('input') input: TransferFundsInput,
    @CurrentUser() user: User,
  ): Promise<TransferResult> {
    return this.paymentsService.transferFunds(user.id, input);
  }

  @Mutation(() => TransferResult, { description: 'Reverse a completed transfer' })
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async reverseTransfer(
    @Args('input') input: ReverseTransferInput,
    @CurrentUser() user: User,
  ): Promise<TransferResult> {
    return this.paymentsService.reverseTransfer(user.id, input);
  }

  @Query(() => TransactionHistoryModel, { description: 'Get transaction history for a wallet' })
  @UseGuards(JwtAuthGuard)
  async transactionHistory(
    @Args('walletId', { type: () => ID }) walletId: string,
    @Args('limit', { type: () => Number, nullable: true, defaultValue: 20 }) limit: number,
    @CurrentUser() _user: User,
  ): Promise<TransactionHistoryModel> {
    // _user is validated by JwtAuthGuard; ownership enforcement can be added here.
    return this.transactionsService.getTransactionHistory(walletId, limit);
  }

  @Query(() => TransactionModel, {
    nullable: true,
    description: 'Get details of a specific transaction by ID',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async transactionDetails(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<TransactionModel | null> {
    const result = await this.transactionsService.getTransactionById(id);
    if (!result) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _type: _discarded, ...data } = result;
    return data as TransactionModel;
  }
}
