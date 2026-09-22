import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../budget/budget.module';
import Redis from 'ioredis';

/**
 * GET /health
 *
 * Returns the liveness + readiness status of all gateway components.
 * Used by Railway/Render for health checks, and displayed in the admin UI.
 *
 * Does NOT ping providers (that would be expensive and slow).
 * Provider health is checked lazily — failures surface in usage_logs.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [postgresStatus, redisStatus] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    const allOk = postgresStatus === 'connected' && redisStatus === 'connected';

    return {
      status: allOk ? 'ok' : 'degraded',
      providers: {
        groq: process.env.GROQ_API_KEY ? 'configured' : 'unconfigured',
        gemini: process.env.GEMINI_API_KEY ? 'configured' : 'unconfigured',
      },
      redis: redisStatus,
      postgres: postgresStatus,
      cache_enabled: process.env.CACHE_ENABLED === 'true' && !!process.env.EMBEDDING_API_KEY,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<string> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'connected';
    } catch (err: any) {
      this.logger.error(`Postgres health check failed: ${err.message}`);
      return 'disconnected';
    }
  }

  private async checkRedis(): Promise<string> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'connected' : 'degraded';
    } catch (err: any) {
      this.logger.error(`Redis health check failed: ${err.message}`);
      return 'disconnected';
    }
  }
}
