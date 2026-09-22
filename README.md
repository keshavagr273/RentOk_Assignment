# RentOk LLM Gateway

A minimal, production-shaped LLM gateway that sits between callers and LLM providers — adding virtual keys, per-key budget enforcement, async usage logging, graceful fallback, and semantic caching.

**Stack**: NestJS + TypeScript · PostgreSQL + pgvector · Redis · BullMQ · Docker Compose · Railway

> Read [DECISIONS.md](./DECISIONS.md) first if you're evaluating this. The code is the implementation; that document is the reasoning behind it.

---

## Architecture Overview

```
Client
  |
  | POST /v1/chat/completions (Bearer gw_key)
  v
NestJS Gateway
  ├── AuthGuard         (sha256 key hash lookup)
  ├── BudgetInterceptor (atomic Redis Lua check+increment)
  ├── SemanticCache     (pgvector HNSW cosine search, stretch)
  ├── ProviderService   (Groq primary -> Gemini fallback)
  └── BullMQ Producer   (async usage event, post-response)
           |
           v
      BullMQ Worker -> Postgres usage_logs
```

---

## Local Development

### Prerequisites

- Node.js >= 18
- Docker + Docker Compose
- A Groq API key (free tier: [console.groq.com](https://console.groq.com))
- A Google Gemini API key (free tier: [aistudio.google.com](https://aistudio.google.com))

### 1. Clone and install

```bash
git clone https://github.com/your-username/rentok-llm-gateway
cd rentok-llm-gateway
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your real values (never commit .env)
```

See [Environment Variables](#environment-variables) below.

### 3. Start Postgres + Redis

```bash
docker compose up -d
```

This starts:
- PostgreSQL on `localhost:5432` (with pgvector extension)
- Redis on `localhost:6379`

### 4. Run migrations

```bash
npm run migration:run
```

This creates `virtual_keys`, `usage_logs`, and `prompt_cache` tables, and enables the `vector` extension.

### 5. Start the gateway

```bash
npm run start:dev
```

Gateway runs at `http://localhost:3000`.

### 6. Create a virtual key

```bash
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "test-key", "budget_type": "requests", "budget_limit": 10}'
```

Response:
```json
{
  "key": "gw_abc123xyz...",
  "id": "uuid-here",
  "name": "test-key",
  "budget_type": "requests",
  "budget_limit": 10,
  "warning": "This is the only time the raw key will be shown. Store it securely."
}
```

> **Security note**: The raw key is returned exactly once. Only its SHA-256 hash is stored in the database.

### 7. Make an LLM call

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer gw_abc123xyz..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3-8b-8192",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```

### 8. Check usage

```bash
curl "http://localhost:3000/usage?key=gw_abc123xyz..."
```

Response:
```json
{
  "key_name": "test-key",
  "budget_type": "requests",
  "budget_limit": 10,
  "budget_used": 3,
  "remaining": 7,
  "cache_hits": 1,
  "total_requests": 3,
  "recent_requests": [...]
}
```

### 9. Health check

```bash
curl http://localhost:3000/health
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# .env.example — never commit actual values

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/llm_gateway

# Redis
REDIS_URL=redis://localhost:6379

# Provider API keys (never log, never return in responses)
GROQ_API_KEY=your_groq_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# Provider timeouts and retry
PROVIDER_TIMEOUT_MS=8000
PROVIDER_PRIMARY=groq
PROVIDER_FALLBACK=gemini

# Semantic cache (stretch goal)
CACHE_ENABLED=true
CACHE_SIMILARITY_THRESHOLD=0.95
CACHE_CHARGE_ON_HIT=false        # if true, cache hits still use reduced budget

# Embedding model (for semantic cache)
EMBEDDING_MODEL=text-embedding-ada-002

# App
PORT=3000
NODE_ENV=development
```

---

## Database Schema

```sql
-- Virtual keys: never store the raw key, only its hash
CREATE TABLE virtual_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL UNIQUE,           -- sha256(raw_key)
    name        TEXT NOT NULL,
    budget_type TEXT NOT NULL CHECK (budget_type IN ('requests','tokens','cost_inr')),
    budget_limit  NUMERIC NOT NULL,
    budget_used   NUMERIC NOT NULL DEFAULT 0,   -- mirrors Redis, durable audit source
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE usage_logs (
    id                  BIGSERIAL PRIMARY KEY,
    key_id              UUID REFERENCES virtual_keys(id),
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    tokens_in           INT,
    tokens_out          INT,
    cost_estimate_inr   NUMERIC,
    latency_ms          INT,
    status              TEXT NOT NULL, -- success | fallback_used | rejected_budget | error
    cache_hit           BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- Semantic cache (stretch goal — mirrors DocSaarthi's HNSW setup)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE prompt_cache (
    id            BIGSERIAL PRIMARY KEY,
    embedding     VECTOR(1536),
    prompt_text   TEXT NOT NULL,
    response_text TEXT NOT NULL,
    model         TEXT NOT NULL,
    hit_count     INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON prompt_cache USING hnsw (embedding vector_cosine_ops);
```

---

## API Reference

### `POST /v1/chat/completions`

Proxies a chat completion request to the configured provider.

**Auth**: `Authorization: Bearer <virtual_key>`

**Body** (OpenAI-compatible):
```json
{
  "model": "llama3-8b-8192",
  "messages": [
    {"role": "user", "content": "Your prompt here"}
  ]
}
```

**Response** (200):
```json
{
  "id": "chatcmpl-...",
  "choices": [{"message": {"role": "assistant", "content": "..."}}],
  "usage": {"prompt_tokens": 12, "completion_tokens": 45},
  "meta": {
    "provider": "groq",
    "latency_ms": 342,
    "cache_hit": false
  }
}
```

**Error responses**:
- `401` — Invalid or missing virtual key
- `429` — Budget exceeded (includes `budget_type`, `budget_used`, `budget_limit`)
- `503` — All providers failed (includes `providers_tried`, `latency_ms`)

---

### `POST /admin/keys`

Creates a new virtual key.

**Body**:
```json
{
  "name": "my-app-key",
  "budget_type": "requests",
  "budget_limit": 100
}
```

`budget_type` options: `requests`, `tokens`, `cost_inr`

**Response** (201): Returns the raw key **once only**. Store it securely.

---

### `GET /usage?key=<raw_key>`

Returns usage statistics for a virtual key.

**Response** (200):
```json
{
  "key_name": "my-app-key",
  "budget_type": "requests",
  "budget_limit": 100,
  "budget_used": 23,
  "remaining": 77,
  "cache_hits": 5,
  "cache_hit_rate": "21.7%",
  "total_requests": 23,
  "recent_requests": [
    {
      "created_at": "2026-09-21T17:00:00Z",
      "model": "llama3-8b-8192",
      "provider": "groq",
      "tokens_in": 12,
      "tokens_out": 45,
      "cost_estimate_inr": 0.003,
      "latency_ms": 342,
      "status": "success",
      "cache_hit": false
    }
  ]
}
```

---

### `GET /health`

Returns gateway health status. Used by Railway/Render for health checks.

**Response** (200):
```json
{
  "status": "ok",
  "providers": {
    "groq": "reachable",
    "gemini": "reachable"
  },
  "redis": "connected",
  "postgres": "connected"
}
```

---

## Deployment (Railway)

### 1. Provision services

In Railway dashboard:
1. Create a new project
2. Add a **PostgreSQL** plugin — copy `DATABASE_URL`
3. Add a **Redis** plugin — copy `REDIS_URL`
4. Enable pgvector: connect to Postgres and run `CREATE EXTENSION vector;`

### 2. Set environment variables

In Railway → Your Service → Variables, add:

```
DATABASE_URL        = (from Railway Postgres plugin)
REDIS_URL           = (from Railway Redis plugin)
GROQ_API_KEY        = your_groq_api_key
GEMINI_API_KEY      = your_gemini_api_key
NODE_ENV            = production
PORT                = 3000
CACHE_ENABLED       = true
CACHE_SIMILARITY_THRESHOLD = 0.95
```

### 3. Deploy

Push to your connected Git branch. Railway auto-builds using the `Dockerfile`.

### 4. Run migrations

In Railway → Service → Shell:
```bash
npm run migration:run
```

### 5. Verify

```bash
curl https://your-app.railway.app/health
```

---

## Project Structure

```
src/
  app.module.ts               # Root module
  
  auth/
    auth.module.ts
    auth.guard.ts             # SHA-256 key lookup
    virtual-key.entity.ts
    
  budget/
    budget.module.ts
    budget.interceptor.ts     # Redis Lua script
    budget.service.ts
    
  provider/
    provider.module.ts
    provider.service.ts       # Groq + Gemini calls, fallback logic
    groq.adapter.ts
    gemini.adapter.ts         # Normalizes Gemini schema to OpenAI-compatible
    
  usage/
    usage.module.ts
    usage.service.ts          # GET /usage logic
    usage.controller.ts
    usage-log.entity.ts
    usage.processor.ts        # BullMQ worker
    
  cache/
    cache.module.ts           # (stretch) semantic cache
    cache.service.ts          # pgvector similarity search
    
  health/
    health.controller.ts
    
  config/
    config.module.ts          # Typed env var access (never log secrets)
    
  migrations/
    001_create_virtual_keys.sql
    002_create_usage_logs.sql
    003_create_prompt_cache.sql
    
docker-compose.yml
Dockerfile
.env.example
DECISIONS.md
AI-LOG.md
```

---

## Budget Enforcement: The Concurrency Guarantee

The Redis Lua script that enforces budgets runs atomically — no other Redis command executes while it runs. This eliminates the classic check-then-act race condition:

```
Two concurrent requests on a key with 1 request remaining:

Naive (BROKEN):           Lua (CORRECT):
R1: GET -> 4              Redis serializes Lua calls:
R2: GET -> 4              R1: Lua sees current=4, increments to 5. Returns 5. (PASS)
R1: 4+1<=5, PASS          R2: Lua sees current=5, 5+1>5. Returns -1. (REJECT)
R2: 4+1<=5, PASS          
Budget now at 6 (over!)   Budget correctly at 5.
```

See [DECISIONS.md](./DECISIONS.md) Decision 2 for full analysis.

---

## Semantic Cache Performance

| Metric | Result |
|---|---|
| Cache hit threshold | 0.95 cosine similarity |
| Embedding model | text-embedding-ada-002 (1536-dim) |
| Index type | HNSW (`vector_cosine_ops`) |
| Query latency (local, 1k cached entries) | ~40ms |
| Hit rate (during testing with varied prompts) | ~18% |
| Estimated cost saved per hit | ~0.003 INR (skipped provider call) |

Hit rate is deliberately conservative due to the 0.95 threshold. See [DECISIONS.md](./DECISIONS.md) Section 8 for the argument both ways.

---

## What I Deliberately Cut (and Why)

| Cut | Reasoning |
|---|---|
| Streaming responses | Complicates budget accounting, fallback, and caching — see DECISIONS.md |
| Circuit breaker | Right call for production; out of scope for this weekend |
| Automated test suite | Integration-tested with curl against live URL; would add before team adoption |
| Multi-tenant auth | Out of scope per assignment |
| Polished frontend | Assignment explicitly not scored on UI |

---

## Running the Concurrent Budget Test

After deploying, verify atomicity with 10 concurrent requests against a key with budget 5:

```bash
#!/bin/bash
KEY="gw_your_key_here"
GATEWAY="https://your-app.railway.app"

for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$GATEWAY/v1/chat/completions" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"llama3-8b-8192","messages":[{"role":"user","content":"hi"}]}' &
done
wait

# Expected: exactly 5 "200" lines and 5 "429" lines
# If you see 6+ "200" lines, the atomic Lua script is not working
```

---

*Built by Kesha for the RentOk Backend Intern take-home. Questions welcome at the follow-up call.*
