import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Global validation pipe — validates all incoming DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(app.get(AllExceptionsFilter));

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`🚀 PayFlow API running at http://localhost:${port}/graphql`);
}

bootstrap().catch((err) => {
  console.error('Failed to start PayFlow:', err);
  process.exit(1);
});
