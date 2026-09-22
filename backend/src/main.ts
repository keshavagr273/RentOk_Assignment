import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // ── CORS ────────────────────────────────────────────────────────────────
  // Allow the frontend (dev: port 3001) and any configured production origins.
  // CORS_ORIGIN env var: comma-separated list of allowed origins.
  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    credentials: false,
  });

  // ── Global Validation Pipe ──────────────────────────────────────────────
  // whitelist: strips unknown properties from DTOs
  // forbidNonWhitelisted: false — allows passthrough of extra OpenAI fields
  //   (e.g. temperature, max_tokens) without erroring; we just don't use them
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  logger.log(`🚀 Gateway running on http://localhost:${port}`);
  logger.log(`   CORS allowed: ${corsOrigins.join(', ')}`);
  logger.log(`   POST /v1/chat/completions — LLM proxy`);
  logger.log(`   POST /admin/keys          — Create virtual key`);
  logger.log(`   GET  /admin/keys          — List virtual keys`);
  logger.log(`   GET  /usage?key=          — Usage stats`);
  logger.log(`   GET  /health              — Health check`);
}

bootstrap();
