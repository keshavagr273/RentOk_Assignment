import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { BudgetService } from './budget.service';
import { BudgetInterceptor } from './budget.interceptor';

/** Injection token for the shared ioredis client */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * BudgetModule is @Global() — the Redis provider is available everywhere
 * without re-importing BudgetModule in every feature module.
 *
 * BullMQ requires { maxRetriesPerRequest: null } on the ioredis connection.
 * We create a single shared Redis instance here and reuse it for both
 * the budget Lua scripts and as the BullMQ backing connection.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('app.redis.url') ?? 'redis://localhost:6379';
        return new Redis(url, {
          maxRetriesPerRequest: null, // Required by BullMQ
          lazyConnect: false,
          enableOfflineQueue: true,
        });
      },
    },
    BudgetService,
    BudgetInterceptor,
  ],
  exports: [REDIS_CLIENT, BudgetService, BudgetInterceptor],
})
export class BudgetModule {}
