import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { VirtualKey } from './auth/virtual-key.entity';
import { UsageLog } from './usage/usage-log.entity';
import { CreateVirtualKeys1001 } from './migrations/001_CreateVirtualKeys';
import { CreateUsageLogs1002 } from './migrations/002_CreateUsageLogs';
import { CreatePromptCache1003 } from './migrations/003_CreatePromptCache';

/**
 * TypeORM data source used by the CLI for migration:run / migration:revert.
 * Run: npm run migration:run
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/llm_gateway',
  entities: [VirtualKey, UsageLog],
  migrations: [CreateVirtualKeys1001, CreateUsageLogs1002, CreatePromptCache1003],
  synchronize: false, // Never auto-sync — always use explicit migrations
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
