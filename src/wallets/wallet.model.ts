import { ObjectType, Field, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class WalletModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field()
  currency!: string;

  /**
   * Balance is returned as a float (e.g. 100.50) in the API,
   * but stored as BigInt in minor units (e.g. 10050 paise).
   * The service layer handles the conversion.
   */
  @Field(() => Float)
  balance!: number;

  @Field()
  status!: string;

  @Field({ nullable: true })
  label?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class WalletBalanceModel {
  @Field(() => ID)
  walletId!: string;

  @Field()
  currency!: string;

  @Field(() => Float)
  balance!: number;

  @Field()
  cachedAt!: Date;
}
