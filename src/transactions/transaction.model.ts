import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class TransactionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  type!: string;

  @Field()
  status!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  currency!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  idempotencyKey?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class TransferModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  senderWalletId!: string;

  @Field(() => ID)
  receiverWalletId!: string;

  @Field()
  status!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  currency!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  idempotencyKey?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class TransactionHistoryModel {
  @Field(() => [TransactionModel])
  payments!: TransactionModel[];

  @Field(() => [TransferModel])
  transfers!: TransferModel[];

  @Field()
  total!: number;
}
