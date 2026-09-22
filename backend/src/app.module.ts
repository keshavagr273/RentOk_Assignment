import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from './config/app.config';
import { VirtualKey } from './auth/virtual-key.entity';
import { UsageLog } from './usage/usage-log.entity';
import { AuthModule } from './auth/auth.module';
import { BudgetModule } from './budget/budget.module';
import { ProviderModule } from './provider/provider.module';
import { CacheModule } from './cache/cache.module';
import { UsageModule } from './usage/usage.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ── Config ─────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
    }),

    // ── Database ───────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('app.database.url'),
        entities: [VirtualKey, UsageLog],
        synchronize: false, // Always use explicit migrations
        ssl:
          config.get<string>('app.env') === 'production'
            ? { rejectUnauthorized: false }
            : false,
        // Connection pool tuned for a small gateway
        extra: { max: 10, idleTimeoutMillis: 30000 },
      }),
    }),

    // ── BullMQ / Redis ─────────────────────────────────────────────────────
    // BullMQ requires maxRetriesPerRequest: null on the Redis connection
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('app.redis.url'),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
      }),
    }),

    // ── Feature Modules ────────────────────────────────────────────────────
    BudgetModule,   // Global — provides Redis client to all other modules
    AuthModule,
    ProviderModule,
    CacheModule,
    UsageModule,
    GatewayModule,
    HealthModule,
  ],
})
export class AppModule {}
