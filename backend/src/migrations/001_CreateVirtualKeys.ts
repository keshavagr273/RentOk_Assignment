import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 001 — Create virtual_keys table.
 *
 * Security design:
 *   - key_hash: SHA-256 of the raw key. The raw key is NEVER stored.
 *   - budget_type: constrained to 3 valid values via CHECK.
 *   - budget_used: mirrors Redis counter; Redis is the enforcement gate,
 *     Postgres is the durable audit record.
 */
export class CreateVirtualKeys1001 implements MigrationInterface {
  name = 'CreateVirtualKeys1001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "virtual_keys" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "key_hash"     TEXT NOT NULL UNIQUE,
        "name"         TEXT NOT NULL,
        "budget_type"  TEXT NOT NULL CHECK (budget_type IN ('requests', 'tokens', 'cost_inr')),
        "budget_limit" NUMERIC NOT NULL,
        "budget_used"  NUMERIC NOT NULL DEFAULT 0,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_virtual_keys_key_hash" ON "virtual_keys" ("key_hash")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "virtual_keys"`);
  }
}
