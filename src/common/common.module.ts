import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { RolesGuard } from './guards/roles.guard';

/**
 * CommonModule provides shared infrastructure services:
 * - PrismaService: database access
 * - RedisService: caching
 * - AllExceptionsFilter: global error handling
 * - RolesGuard: RBAC
 *
 * Marked @Global() so these services are available everywhere without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, RedisService, AllExceptionsFilter, RolesGuard],
  exports: [PrismaService, RedisService, AllExceptionsFilter, RolesGuard],
})
export class CommonModule {}
