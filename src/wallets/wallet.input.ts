import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsOptional, Length, IsIn } from 'class-validator';

@InputType()
export class CreateWalletInput {
  @Field({ nullable: true, defaultValue: 'INR' })
  @IsOptional()
  @IsString()
  @IsIn(['INR', 'USD', 'EUR', 'GBP'], {
    message: 'Supported currencies: INR, USD, EUR, GBP',
  })
  currency?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  label?: string;
}
