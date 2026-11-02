import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class PaymentResult {
  @Field(() => ID)
  id!: string;

  @Field()
  status!: string;

  @Field()
  type!: string;

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
}

@ObjectType()
export class TransferResult {
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
}
