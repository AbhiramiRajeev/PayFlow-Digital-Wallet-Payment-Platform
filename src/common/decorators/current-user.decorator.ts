import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { User } from '@prisma/client';

/**
 * Extracts the authenticated user from the GraphQL context.
 * Usage: @CurrentUser() user: User
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const ctx = GqlExecutionContext.create(context);
  return ctx.getContext<{ req: { user: User } }>().req.user as User;
});
