import { registerAs } from '@nestjs/config';

/**
 * Typed configuration factory.
 * All env var reads flow through here — never access process.env directly elsewhere.
 * This is the only file that touches raw env vars, making secret auditing easy.
 */
export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3001').split(',').map(s => s.trim()),

  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/llm_gateway',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  providers: {
    // Real provider keys — only read here, never returned in responses or logged
    groqApiKey: process.env.GROQ_API_KEY ?? '',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    timeoutMs: parseInt(process.env.PROVIDER_TIMEOUT_MS ?? '8000', 10),
    groqDefaultModel: process.env.GROQ_DEFAULT_MODEL ?? 'qwen/qwen3.8-27b',
    geminiDefaultModel: process.env.GEMINI_DEFAULT_MODEL ?? 'gemini-2.5-flash',
  },

  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    similarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD ?? '0.95'),
    chargeOnHit: process.env.CACHE_CHARGE_ON_HIT === 'true',
    hitCostMultiplier: parseFloat(process.env.CACHE_HIT_COST_MULTIPLIER ?? '0.1'),
    // Embedding — if EMBEDDING_API_KEY is empty, cache silently disables itself
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
    embeddingApiKey: process.env.EMBEDDING_API_KEY ?? '',
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },

  cost: {
    usdToInr: parseFloat(process.env.USD_TO_INR ?? '84'),
  },
}));
