import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

@InputType()
export class RegisterInput {
  @Field()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @Field()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(64, { message: 'Password must not exceed 64 characters' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase, one lowercase, and one number',
  })
  password!: string;

  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName!: string;

  @Field()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName!: string;
}

@InputType()
export class LoginInput {
  @Field()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @Field()
  @IsString()
  @MinLength(1)
  password!: string;
}
