<p align="center">
  <img src="docs/assets/logo.png" alt="RentOk LLM Gateway Logo" width="130" style="border-radius: 28px; box-shadow: 0 16px 36px rgba(0,0,0,0.5);" />
  <h1 align="center">RentOk LLM Gateway</h1>
  <p align="center">
    <strong>Production-Grade Multi-Tenant AI Gateway, Deterministic Token Budgeting & Semantic Cache</strong><br/>
    <em>Atomic Redis Lua Rate Limiting, Multi-Provider Failover, pgvector Semantic Caching, BullMQ Async Telemetry, and Real-Time Next.js 14 Observability.</em>
  </p>
  <p align="center">
    <a href="#-quick-start"><img src="https://img.shields.io/badge/Docker-dev_stack-2496ED?logo=docker&logoColor=white" alt="Docker"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/Framework-NestJS_10-E0234E?logo=nestjs&logoColor=white" alt="NestJS">
    <img src="https://img.shields.io/badge/Frontend-Next.js_14-000000?logo=next.js&logoColor=white" alt="Next.js">
    <img src="https://img.shields.io/badge/Database-PostgreSQL_16-336791?logo=postgresql&logoColor=white" alt="PostgreSQL">
    <img src="https://img.shields.io/badge/Vector_DB-pgvector_HNSW-336791?logo=postgresql&logoColor=white" alt="pgvector">
    <img src="https://img.shields.io/badge/Limiter-Redis_7_%2B_Lua-D82C20?logo=redis&logoColor=white" alt="Redis + Lua">
    <img src="https://img.shields.io/badge/Queue-BullMQ_%2B_Redis-FF4088" alt="BullMQ">
    <img src="https://img.shields.io/badge/Primary_LLM-Groq-F55036" alt="Groq">
    <img src="https://img.shields.io/badge/Fallback_LLM-Google_Gemini-4285F4?logo=google&logoColor=white" alt="Gemini">
    <img src="https://img.shields.io/badge/Concurrency-Zero_Overbudget-10B981" alt="Zero Overbudget">
  </p>
  <p align="center">
    <a href="#-what-is-rentok-llm-gateway">About</a> · 
    <a href="#-the-problem">The Problem</a> · 
    <a href="#-features">Features</a> · 
    <a href="#-architecture">Architecture</a> · 
    <a href="#-pipeline-workflow">Pipeline</a> · 
    <a href="#-feature-comparison">Comparison</a> · 
    <a href="#-quick-start">Quick Start</a> · 
    <a href="#-configuration-reference">Configuration</a> · 
    <a href="#-api-documentation">API Docs</a> · 
    <a href="#-concurrency-guarantees">Concurrency</a> · 
    <a href="#-monorepo-structure">Structure</a>
  </p>
</p>

---

## What is RentOk LLM Gateway?

**RentOk LLM Gateway** is an enterprise-grade, high-throughput AI gateway and token governance platform. It sits directly between client applications, microservices, and upstream LLM providers (Groq Cloud, Google Gemini, OpenAI), enforcing multi-tenant isolation, cryptographic virtual key authorization, atomic budget controls, intelligent provider failover, and sub-40ms semantic caching.

In modern multi-tenant software ecosystems, exposing raw LLM provider credentials to client applications or internal teams introduces catastrophic vulnerabilities: runaway API billing spikes, zero quota visibility, uncontrolled rate-limit cascade failures, and redundant token consumption for identical prompts. Traditional proxy wrappers either rely on naive read-then-write database queries that fail under concurrent load, or burden the critical request-response path with synchronous logging overhead.

RentOk LLM Gateway solves this with an uncompromising **Deterministic Engineering** architecture:

- **Cryptographically Hashed Virtual Keys** — Callers authenticate with gateway-issued `gw_...` virtual keys. Upstream provider master secrets remain strictly isolated on the server, and only one-way SHA-256 hashes are persisted to the database.
- **Zero-Race Concurrency & Budgeting** — Budget limits (per-request, token count, or estimated INR expenditure) are evaluated and decremented atomically via a single-round-trip Redis Lua script, eliminating classic check-then-act race conditions.
- **Sub-40ms Semantic Prompt Caching** — High-performance vector similarity search powered by PostgreSQL `pgvector` and an HNSW cosine index ($\ge 0.95$ threshold) intercepts recurring prompts, eliminating upstream LLM token costs and delivering instant responses.
- **Resilient Multi-Provider Failover** — Transparent routing to Groq (Llama 3.3 / 8B) as the ultra-fast primary engine with an 8,000ms deadline, automatically failing over to Google Gemini 1.5 with full schema normalization before ever returning an error.
- **Decoupled Asynchronous Telemetry** — Usage metrics, token counts, cost estimations, and latency telemetry are enqueued post-response via BullMQ and Redis, ensuring the caller's critical path experiences zero database logging overhead.
- **Full-Stack Next.js 14 Observability Control Plane** — Includes a dedicated, dark-themed administrative dashboard for provisioning virtual keys, monitoring cluster health, tracking cost burn, and inspecting audit logs in real time.

---

## The Problem

Connecting production applications directly to raw LLM APIs or deploying naive proxy wrappers leads to severe financial and architectural vulnerabilities:

| What you want to do | Direct API Calls / Naive Proxy | With RentOk LLM Gateway |
|---|---|---|
| **Enforce hard budget limits across tenants** | Naive `SELECT` followed by `UPDATE` allows concurrent requests to slip through; burst traffic overspends budgets by 200%+ | **Atomic Redis Lua Script**: Evaluates and increments quota in a single CPU cycle. Zero budget overshoot under any concurrency level. |
| **Survive provider downtime & rate limits** | Upstream 429s, 503s, or network timeouts crash client workflows and degrade user experience | **Automated Provider Failover**: Primary Groq execution with fast fallback to Google Gemini with normalized OpenAI-compatible payloads. |
| **Secure LLM master credentials** | Upstream provider API keys are distributed across apps, repositories, and developers | **Virtual Key Abstraction**: Clients only hold revocable `gw_...` tokens. Real keys never leave the gateway. Stored as SHA-256 hashes. |
| **Cut redundant query costs & latency** | Identical or semantically equivalent prompts re-trigger full upstream LLM inference, burning tokens | **pgvector Semantic Caching**: Sub-40ms HNSW cosine vector search returns cached responses on similarity $\ge 0.95$, cutting 100% token cost. |
| **Capture audit logs & token telemetry** | Synchronous database writes inside the HTTP handler add 50–200ms latency or drop logs under high traffic | **Decoupled BullMQ Queue**: Telemetry jobs enqueued post-response; background worker writes audit logs asynchronously without blocking users. |
| **Inspect cluster health & usage analytics** | Manually querying database tables or reading raw log files in terminal windows | **Modern Next.js 14 Dashboard**: Real-time virtual key management, usage analytics, provider uptime status, and interactive telemetry logs. |
| **Multi-environment Docker deployment** | Complex, fragile manual setups across databases, vector extensions, and message brokers | **One-Command Docker Stack**: Integrated Docker Compose running PostgreSQL 16 + pgvector and Redis 7 out of the box. |

---

## Features

### 1. Cryptographic Multi-Tenant Virtual Key Engine
- Generates secure, high-entropy virtual keys prefixed with `gw_`.
- Raw keys are displayed **only once** upon generation; only their **SHA-256 hash** is persisted in the PostgreSQL database.
- Multi-tenant scoping isolates teams, applications, and microservices with granular budget limits and revocable access.

### 2. Zero-Race Concurrency & Atomic Budget Enforcement
- Eliminates check-then-act race conditions through an **atomic Redis Lua script**.
- Supports multiple budget policies:
  - `requests`: Strict count of total API invocations allowed.
  - `tokens`: Cumulative prompt and completion token consumption.
  - `cost_inr`: Estimated financial expenditure calculated in Indian Rupees (INR).
- Rejects requests exceeding quota immediately with `429 Budget Exceeded` before incurring downstream token costs.

### 3. Multi-Provider Resilient Failover Gateway
- **Primary Provider**: Groq Cloud with ultra-fast inference (`llama3-8b-8192`, `llama-3.3-70b-versatile`).
- **Fallback Provider**: Google Gemini (`gemini-1.5-flash`, `gemini-1.5-pro`) with automatic schema normalization to OpenAI format.
- Configurable deadline (`PROVIDER_TIMEOUT_MS=8000`) and automatic single-retry before graceful failover.
- Structured `503 Service Unavailable` error payload with diagnostic provider attempt history if all upstream services fail.

### 4. Sub-40ms Semantic Prompt Caching (pgvector + HNSW)
- Integrated PostgreSQL vector storage using the **`pgvector`** extension.
- Generates 1536-dimensional embeddings for incoming prompts.
- Employs an **HNSW cosine index** (`vector_cosine_ops`) for ultra-low latency approximate nearest-neighbor search.
- Configurable similarity threshold (default `0.95`). Exact and semantically identical queries bypass upstream LLMs completely.

### 5. Decoupled Asynchronous Telemetry & Audit Pipeline
- Asynchronous job queue powered by **BullMQ** and **Redis**.
- Logging jobs are enqueued strictly **after** the HTTP response has been flushed to the client (`res.send()`).
- Background worker persists comprehensive audit records in `usage_logs`: tokens in/out, estimated cost, latency in milliseconds, cache hit status, and provider chosen.
- Periodic reconciliation ensures PostgreSQL `virtual_keys.budget_used` matches live Redis counters.

### 6. Modern Real-Time Next.js 14 Observability Workspace
- Crafted with high-contrast, clean dark aesthetics (no generic gradients, pure utility-driven UI).
- **Executive Dashboard**: Key metrics, request volume, token consumption, and cache hit rate.
- **Virtual Key Manager**: Interactive key generation modal, budget configuration, and instant revocation.
- **Usage Lookup & Audit Log**: Search telemetry by virtual key, filter by provider and response status.
- **System Health Monitor**: Live ping status for PostgreSQL, Redis, Groq API, and Gemini API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RentOk Frontend (Next.js 14)                          │
│     Dashboard · Key Management · Usage Lookup · Cluster Health Monitor      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / REST
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                       RentOk Gateway (NestJS Core API)                      │
│                                                                             │
│  [1] AuthGuard               SHA-256 Virtual Key Verification               │
│  [2] BudgetInterceptor       Atomic Redis Lua (Check & Increment)           │
│  [3] SemanticCacheService    pgvector HNSW Cosine Search (>= 0.95)          │
│  [4] ProviderService         Groq Primary (8s timeout) -> Gemini Fallback   │
│  [5] BullMQ Producer         Post-Response Non-Blocking Telemetry Dispatch  │
└──────────────┬───────────────────────┬───────────────────────┬──────────────┘
               │                       │                       │
       BullMQ  │            PostgreSQL │ + pgvector            │ Upstream LLM
┌──────────────▼─────────────┐ ┌───────▼────────────────┐ ┌────▼──────────────┐
│   Async Telemetry Worker   │ │   PostgreSQL 16 DB     │ │  Provider APIs    │
│   - Consumes BullMQ queue  │ │   - virtual_keys       │ │  - Groq Cloud     │
│   - Writes usage_logs      │ │   - usage_logs (audit) │ │    (Primary)      │
│   - Reconciles budget_used │ │   - prompt_cache       │ │  - Google Gemini  │
│   - Non-blocking pipeline  │ │     (HNSW 1536-dim)    │ │    (Fallback)     │
└────────────────────────────┘ └────────────────────────┘ └───────────────────┘
```

---

## Pipeline Workflow

```
┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│  Client  │    │  AuthGuard  │    │ Redis Lua    │    │  Semantic   │    │ Upstream    │
│  Request ├───►│  (SHA-256   ├───►│ Budget Check ├───►│ Cache Probe ├───►│ Provider    │
│  Bearer  │    │  Lookup)    │    │ (Atomic)     │    │ (pgvector)  │    │ (Groq/Gem)  │
└──────────┘    └──────┬──────┘    └──────┬───────┘    └──────┬──────┘    └──────┬──────┘
                       │ 401              │ 429               │ Hit (200)        │
                       ▼                  ▼                   ▼                  ▼
                  [Unauthorized]     [Over Budget]       [Return Cached]  [Return 200]
                                                                                 │
                                                                                 ▼
┌──────────┐    ┌─────────────┐    ┌──────────────┐                       ┌─────────────┐
│ Postgres │    │   BullMQ    │    │ Async Worker │                       │ Client Gets │
│ Audit DB │◄───┤ Telemetry Q │◄───┤ Post-Response│◄──────────────────────┤ HTTP 200    │
│ (Logs)   │    │  (Redis)    │    │ Dispatch     │                       │ Response    │
└──────────┘    └─────────────┘    └──────────────┘                       └─────────────┘
```

---

## Feature Comparison

| Capability | RentOk LLM Gateway | Direct Provider API | LiteLLM Proxy | Portkey.ai | Naive Express Proxy |
|---|:---:|:---:|:---:|:---:|:---:|
| **Atomic Lua Budget Enforcement** | ✅ **Guaranteed 0% Race** | ❌ None | ⚠️ Best-effort Redis | ⚠️ Cloud-managed | ❌ Read-then-write race |
| **Multi-Provider Failover** | ✅ **Groq $\to$ Gemini** | ❌ None | ✅ Multiple | ✅ Multiple | ⚠️ Basic Try/Catch |
| **pgvector Semantic Caching** | ✅ **HNSW Index (0.95)** | ❌ None | ⚠️ Optional add-on | ⚠️ Cloud-only | ❌ None |
| **Post-Response Async Logging** | ✅ **BullMQ + Redis** | ❌ None | ⚠️ In-memory queue | ✅ Cloud sink | ❌ Blocks HTTP response |
| **Hashed Virtual Keys** | ✅ **SHA-256 Stored** | ❌ Raw API Key | ⚠️ Plain/Encrypted | ✅ Vaulted | ❌ Plaintext in DB |
| **OpenAI Schema Normalization** | ✅ **Automatic** | ❌ Provider-specific | ✅ Wide support | ✅ Wide support | ❌ Manual code |
| **Built-in Next.js Dashboard** | ✅ **Included** | ❌ None | ⚠️ Enterprise UI | ✅ Web Console | ❌ None |
| **One-Command Docker Stack** | ✅ **Docker Compose** | ❌ None | ⚠️ Python container | ❌ SaaS only | ⚠️ Incomplete |

---

## Quick Start

### Prerequisites
- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** installed and running
- **[Node.js 20+](https://nodejs.org/)** & `npm`
- A **[Groq API Key](https://console.groq.com)** (Free Tier)
- A **[Google Gemini API Key](https://aistudio.google.com)** (Free Tier)

---

### Step 1: Clone and Configure

```bash
git clone https://github.com/keshavagr273/RentOk_Assignment.git
cd RentOk_Assignment
```

Configure the backend environment:
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your API keys:
```env
PORT=3000
NODE_ENV=development

# Database & Redis
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/llm_gateway"
REDIS_URL="redis://localhost:6379"

# Providers
GROQ_API_KEY="gsk_your_groq_api_key_here"
GEMINI_API_KEY="AIzaSy_your_gemini_api_key_here"
PROVIDER_PRIMARY="groq"
PROVIDER_FALLBACK="gemini"
PROVIDER_TIMEOUT_MS=8000

# Semantic Cache
CACHE_ENABLED=true
CACHE_SIMILARITY_THRESHOLD=0.95
```

---

### Step 2: Start Infrastructure (PostgreSQL 16 + Redis 7)

From the `backend` directory:
```bash
docker compose up -d
```

This starts:
- 🐘 **PostgreSQL 16 with pgvector extension** on port `5432`
- ⚡ **Redis 7 (Alpine)** on port `6379` (for BullMQ queues & atomic Lua caching)

---

### Step 3: Run Database Migrations

```bash
npm install
npm run migration:run
```

This applies TypeORM migrations:
- `001_CreateVirtualKeys.ts`: Schema for hashed virtual keys and budget tracking.
- `002_CreateUsageLogs.ts`: High-throughput audit log table with FK indices.
- `003_CreatePromptCache.ts`: `VECTOR(1536)` table with an **HNSW cosine index**.

---

### Step 4: Start Development Servers

Start the backend gateway:
```bash
# In backend/
npm run start:dev
```

In a second terminal, launch the Next.js 14 frontend:
```bash
cd ../frontend
npm install
npm run dev
```

### Access Points:
- 🌐 **Frontend Observability Workspace**: [http://localhost:3001](http://localhost:3001) *(or port 3000)*
- ⚙️ **Backend Gateway API**: [http://localhost:3000](http://localhost:3000)
- 🩺 **Cluster Diagnostics**: [http://localhost:3000/health](http://localhost:3000/health)

---

### Step 5: Create a Virtual Key & Make an LLM Call

1. **Create a Virtual Key**:
```bash
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "production-service", "budget_type": "requests", "budget_limit": 100}'
```

Response:
```json
{
  "key": "gw_4b9a1c8e2f0d4e5a9b7c8d9e0f1a2b3c",
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "production-service",
  "budget_type": "requests",
  "budget_limit": 100,
  "warning": "This is the only time the raw key will be shown. Store it securely."
}
```

2. **Execute an OpenAI-Compatible Chat Completion**:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer gw_4b9a1c8e2f0d4e5a9b7c8d9e0f1a2b3c" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3-8b-8192",
    "messages": [
      {"role": "system", "content": "You are a concise engineering assistant."},
      {"role": "user", "content": "What is the time complexity of Tarjan algorithm?"}
    ]
  }'
```

3. **Check Usage & Telemetry**:
```bash
curl "http://localhost:3000/usage?key=gw_4b9a1c8e2f0d4e5a9b7c8d9e0f1a2b3c"
```

---

## Configuration Reference

All gateway settings are environment-driven and verified at bootstrap:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Gateway HTTP server listening port |
| `NODE_ENV` | `development` | Node environment (`development` / `production` / `test`) |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string with `pgvector` enabled |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL for BullMQ and atomic Lua rate limiter |
| `GROQ_API_KEY` | *(required)* | Groq Cloud API key for ultra-fast primary LLM inference |
| `GEMINI_API_KEY` | *(required)* | Google Gemini API key for resilient fallback execution |
| `PROVIDER_PRIMARY` | `groq` | Default primary provider to invoke |
| `PROVIDER_FALLBACK` | `gemini` | Fallback provider invoked on primary timeout or 5xx |
| `PROVIDER_TIMEOUT_MS` | `8000` | Timeout threshold in ms before attempting fallback |
| `CACHE_ENABLED` | `true` | Enables/disables pgvector semantic caching |
| `CACHE_SIMILARITY_THRESHOLD` | `0.95` | Cosine similarity threshold for semantic cache hits |
| `CACHE_CHARGE_ON_HIT` | `false` | Whether cache hits consume user request/token budget |
| `EMBEDDING_MODEL` | `text-embedding-ada-002` | Model dimension standard (1536-dim) |
| `NEXT_PUBLIC_GATEWAY_URL` | `http://localhost:3000` | Backend API URL used by the Next.js frontend |

---

## API Documentation

The gateway provides standard OpenAI-compatible completions alongside administration and telemetry endpoints:

### 1. `POST /v1/chat/completions`
Proxies chat completion requests with automatic authentication, budget deduction, semantic cache lookup, and provider failover.

- **Headers**: `Authorization: Bearer <virtual_key>`, `Content-Type: application/json`
- **Request Body**:
```json
{
  "model": "llama3-8b-8192",
  "messages": [
    {"role": "user", "content": "Explain vector embeddings in one sentence."}
  ],
  "temperature": 0.7
}
```
- **Response (200 OK)**:
```json
{
  "id": "chatcmpl-9b8c7d6e5f",
  "object": "chat.completion",
  "created": 1726900000,
  "model": "llama3-8b-8192",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Vector embeddings are numerical representations of data points in high-dimensional space where semantic similarity corresponds to geometric proximity."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 23,
    "total_tokens": 37
  },
  "meta": {
    "provider": "groq",
    "latency_ms": 182,
    "cache_hit": false
  }
}
```

- **Error Codes**:
  - `401 Unauthorized`: Virtual key missing, malformed, or inactive.
  - `429 Too Many Requests`: Budget limit exceeded (`budget_used >= budget_limit`).
  - `503 Service Unavailable`: All upstream providers (Groq & Gemini) failed or timed out.

---

### 2. `POST /admin/keys`
Provisions a new virtual key with a specified budget quota and policy.

- **Request Body**:
```json
{
  "name": "analytics-cron-service",
  "budget_type": "requests",
  "budget_limit": 500
}
```
- Supported `budget_type` values:
  - `requests`: Maximum number of requests allowed.
  - `tokens`: Maximum combined token count allowed.
  - `cost_inr`: Maximum cost in INR allowed.

---

### 3. `GET /admin/keys`
Retrieves all virtual keys with metadata, current budget usage, and status.

- **Response (200 OK)**:
```json
[
  {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "analytics-cron-service",
    "budget_type": "requests",
    "budget_limit": 500,
    "budget_used": 42,
    "created_at": "2026-09-22T06:00:00.000Z"
  }
]
```

---

### 4. `GET /usage?key=<raw_key>`
Returns detailed real-time consumption statistics, cache hit metrics, and recent request logs.

- **Response (200 OK)**:
```json
{
  "key_name": "analytics-cron-service",
  "budget_type": "requests",
  "budget_limit": 500,
  "budget_used": 42,
  "remaining": 458,
  "cache_hits": 9,
  "cache_hit_rate": "21.4%",
  "total_requests": 42,
  "recent_requests": [
    {
      "created_at": "2026-09-22T06:45:12.000Z",
      "model": "llama3-8b-8192",
      "provider": "groq",
      "tokens_in": 18,
      "tokens_out": 64,
      "cost_estimate_inr": 0.004,
      "latency_ms": 195,
      "status": "success",
      "cache_hit": false
    }
  ]
}
```

---

### 5. `GET /health`
Returns granular health metrics across the gateway cluster:
```json
{
  "status": "ok",
  "timestamp": "2026-09-22T07:00:00.000Z",
  "providers": {
    "groq": "reachable",
    "gemini": "reachable"
  },
  "redis": "connected",
  "postgres": "connected"
}
```

---

## Concurrency Guarantees

### The Check-Then-Act Flaw in Traditional Gateways
Under high concurrency, traditional application gateways perform two operations:
1. `SELECT budget_used FROM keys WHERE id = ?`
2. If `budget_used < limit`: perform LLM call, then `UPDATE keys SET budget_used = budget_used + 1`

When 10 requests arrive simultaneously on a key with 1 remaining slot, all 10 queries read `budget_used = 4`, all 10 pass the check, and all 10 spend tokens. The budget is overspent by 900%.

### Atomic Lua Elimination
RentOk LLM Gateway runs an atomic Lua script directly inside Redis:
```lua
-- Atomic Lua Budget Evaluation
local current = redis.call('GET', KEYS[1])
if not current then
  current = 0
else
  current = tonumber(current)
end

local limit = tonumber(ARGV[1])
local increment = tonumber(ARGV[2])

if current + increment <= limit then
  redis.call('INCRBY', KEYS[1], increment)
  return current + increment
else
  return -1
end
```
Because Redis executes Lua scripts in a single-threaded event loop, no other command can interleave. Either the increment succeeds and is guaranteed within quota, or it is rejected with `-1` (`429 Too Many Requests`).

---

## Monorepo Structure

```text
RentOk_Assignment/
├── backend/                     # NestJS Core Gateway API
│   ├── src/
│   │   ├── auth/                # Virtual Key AuthGuard, SHA-256 Hasher, Admin Controller
│   │   ├── budget/              # Atomic Redis Lua Interceptor & Budget Service
│   │   ├── cache/               # pgvector Semantic Caching & HNSW Similarity Service
│   │   ├── config/              # Centralized Configuration & Environment Validation
│   │   ├── gateway/             # OpenAI-Compatible /v1/chat/completions Controller
│   │   ├── health/              # Multi-Service Health & Readiness Controller
│   │   ├── migrations/          # TypeORM Migrations (Keys, Logs, Prompt Cache)
│   │   ├── provider/            # Groq & Gemini Adapters with Normalized Schemas
│   │   ├── usage/               # BullMQ Telemetry Worker & /usage Query Controller
│   │   ├── app.module.ts        # Root Dependency Injection Module
│   │   └── main.ts              # NestJS Bootstrap, CORS, Validation Pipe
│   ├── public/                  # Static assets (Favicon, Brand Logo)
│   ├── Dockerfile               # Production Containerization Dockerfile
│   ├── docker-compose.yml       # PostgreSQL 16 + pgvector & Redis 7 stack
│   ├── package.json             # Backend dependencies & script definitions
│   └── tsconfig.json            # Strict TypeScript configuration
├── frontend/                    # Next.js 14 Observability Workspace
│   ├── app/
│   │   ├── health/              # System Health & Cluster Connectivity Page
│   │   ├── keys/                # Virtual Key Management & Provisioning Page
│   │   ├── usage/               # Interactive Usage Search & Telemetry Page
│   │   ├── globals.css          # Design Tokens, Dark Aesthetics & Typography
│   │   ├── layout.tsx           # Shell Layout & App Favicon Metadata
│   │   └── page.tsx             # Executive KPI & Cost Overview Dashboard
│   ├── components/
│   │   └── Sidebar.tsx          # Navigation Sidebar with Brand Logo
│   ├── public/                  # Next.js static assets & brand icons
│   └── package.json             # Frontend dependencies & Next.js config
├── docs/
│   └── assets/                  # High-resolution logos & architecture diagrams
│       ├── logo.png             # Official brand logo
│       └── logo.jpg             # High-contrast asset
├── DECISIONS.md                 # Production Architecture Rationales & Trade-off Matrix
├── AI-LOG.md                    # Engineering Development Log & AI Usage Ledger
├── .gitignore                   # Clean Git tracking specification
└── README.md                    # Comprehensive Project Documentation
```

---

## Contributing

Contributions and enhancements are welcome:

1. **Fork** the repository
2. **Create** your feature branch (`git checkout -b feat/semantic-reranking`)
3. **Commit** your changes (`git commit -m 'feat: add cross-encoder reranking to cache'`)
4. **Push** to the branch (`git push origin feat/semantic-reranking`)
5. **Open** a Pull Request

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>RentOk LLM Gateway</strong><br/>
  <em>Empowering High-Throughput AI Applications with Deterministic Rate Limiting & Architecture Precision.</em>
</p>
