import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 002 — Create usage_logs table.
 *
 * Immutable audit log of every request.
 * Written asynchronously by the BullMQ worker (post-response).
 *
 * Indexes:
 *   - key_id: for fast per-key usage queries (GET /usage)
 *   - created_at: for time-range queries (dashboard, analytics)
 */
export class CreateUsageLogs1002 implements MigrationInterface {
  name = 'CreateUsageLogs1002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "usage_logs" (
        "id"                BIGSERIAL PRIMARY KEY,
        "key_id"            UUID REFERENCES "virtual_keys"("id") ON DELETE SET NULL,
        "provider"          TEXT NOT NULL,
        "model"             TEXT NOT NULL,
        "tokens_in"         INT,
        "tokens_out"        INT,
        "cost_estimate_inr" NUMERIC(10, 6),
        "latency_ms"        INT,
        "status"            TEXT NOT NULL,
        "cache_hit"         BOOLEAN NOT NULL DEFAULT false,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_usage_logs_key_id"     ON "usage_logs" ("key_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_usage_logs_created_at" ON "usage_logs" ("created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "usage_logs"`);
  }
}
