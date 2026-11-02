import { InputType, Field, Float } from '@nestjs/graphql';
import { IsString, IsOptional, IsPositive, MaxLength, IsUUID, Min, Max } from 'class-validator';

@InputType()
export class AddFundsInput {
  @Field(() => String)
  @IsUUID()
  walletId!: string;

  /**
   * Amount in major currency units (e.g. 100.50 for ₹100.50).
   * The service converts this to minor units (paise) before storage.
   */
  @Field(() => Float)
  @IsPositive({ message: 'Amount must be greater than zero' })
  @Min(1, { message: 'Minimum deposit is ₹1' })
  @Max(1_000_000, { message: 'Maximum single deposit is ₹10,00,000' })
  amount!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Idempotency key — include this to safely retry the operation.
   * The same key with the same payload will return the original result.
   * The same key with a DIFFERENT payload will be rejected with 409.
   */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

@InputType()
export class TransferFundsInput {
  @Field(() => String)
  @IsUUID()
  senderWalletId!: string;

  @Field(() => String)
  @IsUUID()
  receiverWalletId!: string;

  @Field(() => Float)
  @IsPositive({ message: 'Amount must be greater than zero' })
  @Min(1, { message: 'Minimum transfer is ₹1' })
  @Max(1_000_000, { message: 'Maximum single transfer is ₹10,00,000' })
  amount!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

@InputType()
export class ReverseTransferInput {
  @Field(() => String)
  @IsUUID()
  transferId!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
