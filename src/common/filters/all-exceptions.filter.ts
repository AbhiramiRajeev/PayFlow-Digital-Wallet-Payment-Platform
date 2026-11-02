import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { GqlArgumentsHost, GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

/**
 * Global exception filter that converts all exceptions into structured
 * GraphQL errors with consistent error codes and messages.
 */
@Catch()
export class AllExceptionsFilter implements GqlExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): GraphQLError {
    GqlArgumentsHost.create(host);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string' ? response : (response as Record<string, unknown>).message;

      this.logger.warn(`HTTP ${status}: ${JSON.stringify(message)}`);

      return new GraphQLError(Array.isArray(message) ? message.join(', ') : String(message), {
        extensions: {
          code: this.httpStatusToCode(status),
          statusCode: status,
        },
      });
    }

    if (exception instanceof GraphQLError) {
      return exception;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`Unhandled exception: ${err.message}`, err.stack);

    return new GraphQLError('Internal server error', {
      extensions: {
        code: 'INTERNAL_SERVER_ERROR',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      },
    });
  }

  private httpStatusToCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
    };
    return codes[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}
