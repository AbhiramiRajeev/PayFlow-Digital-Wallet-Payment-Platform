import { Resolver, Mutation, Args, Query } from '@nestjs/graphql';
import { UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterInput, LoginInput } from './auth.input';
import { AuthPayload } from './auth.model';
import { UserModel } from '../users/user.model';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload, { description: 'Register a new user account' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async register(@Args('input') input: RegisterInput): Promise<AuthPayload> {
    return this.authService.register(input);
  }

  @Mutation(() => AuthPayload, { description: 'Authenticate with email and password' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async login(@Args('input') input: LoginInput): Promise<AuthPayload> {
    return this.authService.login(input);
  }

  @Query(() => UserModel, { description: 'Get the currently authenticated user' })
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): UserModel {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
