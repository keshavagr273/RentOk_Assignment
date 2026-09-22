import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../budget/budget.module';
import Redis from 'ioredis';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

export interface CacheHitResult {
  responseText: string;
  cacheId: number;
}

/**
 * Semantic cache service — stretch goal.
 *
 * Uses pgvector HNSW indexing (same architecture as DocSaarthi) to find
 * semantically similar prompts and return cached responses without calling
 * the provider.
 *
 * Threshold: 0.95 cosine similarity — conservative starting point.
 * See DECISIONS.md Section 8 for the full "argue both sides" analysis.
 *
 * Known limitation (documented in DECISIONS.md):
 *   Semantically similar ≠ same intent.
 *   "What is the capital of France?" and "Tell me about France's capital?"
 *   have high similarity but identical cached responses are acceptable.
 *   However, "What year did France become a country?" vs "What is France?"
 *   might score 0.95 from embedding noise — the conservative threshold
 *   mitigates this risk.
 *
 * The cache is silently disabled if EMBEDDING_API_KEY is not configured.
 */
@Injectable()
export class SemanticCacheService implements OnModuleInit {
  private readonly logger = new Logger(SemanticCacheService.name);
  private cacheEffectivelyEnabled = false;
  private hitCount = 0;
  private totalCount = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    const cacheEnabled = this.config.get<boolean>('app.cache.enabled');
    const embeddingKey = this.config.get<string>('app.cache.embeddingApiKey');

    if (!cacheEnabled) {
      this.logger.log('Semantic cache disabled (CACHE_ENABLED=false)');
      return;
    }
    if (!embeddingKey) {
      this.logger.warn(
        'Semantic cache DISABLED: EMBEDDING_API_KEY not configured. ' +
        'Set EMBEDDING_API_KEY to enable the semantic cache stretch goal.',
      );
      return;
    }

    this.cacheEffectivelyEnabled = true;
    this.logger.log(
      `Semantic cache ENABLED — threshold: ${this.config.get('app.cache.similarityThreshold')}, ` +
      `model: ${this.config.get('app.cache.embeddingModel')}`,
    );
  }

  get isEnabled(): boolean {
    return this.cacheEffectivelyEnabled;
  }

  /** Current cache hit rate as a percentage string */
  get hitRate(): string {
    if (this.totalCount === 0) return '0.0%';
    return `${((this.hitCount / this.totalCount) * 100).toFixed(1)}%`;
  }

  /**
   * Check if a prompt has a cached response with cosine similarity >= threshold.
   * Returns the cached response if found, null if no match.
   *
   * This uses pgvector's <=> cosine distance operator with the HNSW index
   * (same pattern as DocSaarthi's document retrieval — see AI-LOG.md).
   */
  async findSimilar(
    messages: Array<{ role: string; content: string }>,
    model: string,
  ): Promise<CacheHitResult | null> {
    if (!this.cacheEffectivelyEnabled) return null;

    const promptText = this.normalizePrompt(messages);
    this.totalCount++;

    try {
      // Get embedding for the incoming prompt
      const embeddingResult = await this.embed(promptText);

      const threshold = this.config.get<number>('app.cache.similarityThreshold') ?? 0.95;
      // pgvector cosine distance: 1 - cosine_similarity
      // similarity >= 0.95 means distance <= 0.05
      const maxDistance = 1 - threshold;

      const embedding = JSON.stringify(embeddingResult.embedding);

      // HNSW index query — fast approximate nearest neighbor
      const rows = await this.dataSource.query(
        `SELECT id, response_text, 1 - (embedding <=> $1::vector) AS similarity
         FROM prompt_cache
         WHERE 1 - (embedding <=> $1::vector) >= $2
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        [embedding, threshold],
      );

      if (rows.length > 0) {
        this.hitCount++;
        this.logger.log(
          `Cache HIT (similarity: ${Number(rows[0].similarity).toFixed(4)}) — skipping provider call`,
        );
        // Increment hit_count in background (non-blocking)
        this.dataSource
          .query('UPDATE prompt_cache SET hit_count = hit_count + 1 WHERE id = $1', [rows[0].id])
          .catch((e) => this.logger.error(`Failed to update hit_count: ${e.message}`));

        return { responseText: rows[0].response_text, cacheId: rows[0].id };
      }

      this.logger.debug('Cache MISS — proceeding to provider call');
      return null;
    } catch (err: any) {
      // Cache errors must NEVER fail the request — degrade gracefully
      this.logger.error(`Cache lookup error (degrading gracefully): ${err.message}`);
      return null;
    }
  }

  /**
   * Store a prompt/response pair in the cache after a successful provider call.
   * Non-blocking — errors here must not affect the response to the caller.
   */
  async store(
    messages: Array<{ role: string; content: string }>,
    responseText: string,
    model: string,
  ): Promise<void> {
    if (!this.cacheEffectivelyEnabled) return;

    const promptText = this.normalizePrompt(messages);

    try {
      const embeddingResult = await this.embed(promptText);
      const embedding = JSON.stringify(embeddingResult.embedding);

      await this.dataSource.query(
        `INSERT INTO prompt_cache (embedding, prompt_text, response_text, model, hit_count)
         VALUES ($1::vector, $2, $3, $4, 0)`,
        [embedding, promptText, responseText, model],
      );

      this.logger.debug(`Stored new cache entry (${embeddingResult.model})`);
    } catch (err: any) {
      // Store errors must NEVER fail the request
      this.logger.error(`Cache store error (non-fatal): ${err.message}`);
    }
  }

  /** Normalize multi-turn messages into a single string for embedding */
  private normalizePrompt(messages: Array<{ role: string; content: string }>): string {
    // Only embed the last user message for caching — reduces semantic noise
    // from conversation history context
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) return lastUserMsg.content.trim();

    // Fallback: concat all messages
    return messages.map((m) => `${m.role}: ${m.content}`).join('\n').trim();
  }

  /** Call the configured embedding endpoint to get a vector */
  private async embed(text: string): Promise<EmbeddingResult> {
    const baseUrl = this.config.get<string>('app.cache.embeddingBaseUrl');
    const apiKey = this.config.get<string>('app.cache.embeddingApiKey');
    const model = this.config.get<string>('app.cache.embeddingModel') ?? 'text-embedding-3-small';

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 100)}`);
    }

    const data = await response.json();
    return {
      embedding: data.data[0].embedding,
      model: data.model ?? model,
    };
  }
}
