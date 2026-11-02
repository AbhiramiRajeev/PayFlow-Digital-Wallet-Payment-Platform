import { ObjectType, Field } from '@nestjs/graphql';
import { UserModel } from '../users/user.model';

@ObjectType()
export class AuthPayload {
  @Field()
  accessToken!: string;

  @Field()
  tokenType!: string;

  @Field()
  expiresIn!: string;

  @Field(() => UserModel)
  user!: UserModel;
}
