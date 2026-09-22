import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 003 — Create prompt_cache table for semantic caching (stretch goal).
 *
 * Mirrors the architecture from DocSaarthi (see AI-LOG.md, DECISIONS.md Section 5):
 *   - pgvector VECTOR(1536) for text-embedding-3-small / text-embedding-ada-002 embeddings
 *   - HNSW index with cosine distance operator (vector_cosine_ops)
 *   - HNSW chosen over IVFFlat because it doesn't require a separate training step
 *     and performs better at small-to-medium dataset sizes (< 1M vectors)
 *
 * HNSW parameters (defaults):
 *   - m = 16 (default): max connections per node per layer
 *   - ef_construction = 64 (default): build-time quality vs speed trade-off
 *   For production scale, tune ef_search per query via SET LOCAL.
 *
 * The `vector` extension must be available. The pgvector/pgvector Docker image
 * (used in docker-compose.yml) provides this automatically.
 */
export class CreatePromptCache1003 implements MigrationInterface {
  name = 'CreatePromptCache1003';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension — idempotent
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prompt_cache" (
        "id"            BIGSERIAL PRIMARY KEY,
        "embedding"     VECTOR(1536) NOT NULL,
        "prompt_text"   TEXT NOT NULL,
        "response_text" TEXT NOT NULL,
        "model"         TEXT NOT NULL,
        "hit_count"     INT NOT NULL DEFAULT 0,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // HNSW index for approximate nearest-neighbor cosine search
    // <=> is the cosine distance operator in pgvector
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prompt_cache_embedding_hnsw"
      ON "prompt_cache"
      USING hnsw (embedding vector_cosine_ops)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "prompt_cache"`);
    // Note: we do NOT drop the vector extension on down — other tables may use it
  }
}
