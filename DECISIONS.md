# DECISIONS.md — RentOk LLM Gateway

> **Author note**: Every decision below is backed by a production scar, not a tutorial read. Where I say "I've done this before", I mean exactly that — the same architecture patterns show up in my DocSaarthi (BullMQ + pgvector), Enalo (OAuth + encrypted credentials), and SYNQ (multi-provider LLM routing) projects. I'm flagging that explicitly because it's the most honest answer to "how'd you know to do it that way?"

---

## 1. What I Built (3–4 sentences)

A minimal but production-shaped LLM gateway built on **NestJS + TypeScript**, backed by **PostgreSQL** (with `pgvector` extension) and **Redis**, using **BullMQ** for async usage logging. Callers authenticate via a gateway-issued virtual key; real provider credentials (Groq as primary, Google Gemini as fallback) live only in environment variables — they never touch a response body or a log line. Budget enforcement is handled atomically via a **Redis Lua script** to prevent race conditions on near-exhausted keys, and usage events are enqueued to BullMQ post-response so logging never adds latency to the caller. As a stretch goal, I added **semantic caching via pgvector + HNSW indexing**, the same architecture I run in DocSaarthi at sub-120ms recall, tuned to a 0.95 cosine-similarity threshold.

---

## 2. Moving Parts & Request Lifecycle

```
Client
  |
  |  POST /v1/chat/completions
  |  Authorization: Bearer gw_xxxxx
  |
  v
+--------------------------------------------------------------+
|                     NestJS Gateway                           |
|                                                              |
|  [1] AuthGuard                                               |
|      SHA-256(raw_key) -> look up virtual_keys table          |
|      -> 401 if not found                                     |
|                                                              |
|  [2] BudgetInterceptor  (Redis Lua script, atomic)           |
|      'requests': Lua check+increment -> 429 if over limit    |
|      'tokens'/'cost_inr': read-only pre-check (documented    |
|       tradeoff — atomic enforcement only for 'requests')     |
|                                                              |
|  [3] SemanticCacheService  (stretch goal)                    |
|      embed prompt -> pgvector cosine search                  |
|      -> if similarity >= 0.95: return cached response        |
|         log cache_hit=true, skip provider call               |
|                                                              |
|  [4] ProviderService                                         |
|      -> call Groq (primary), 8 s timeout                    |
|      -> on timeout/5xx: one retry on Groq                    |
|      -> if retry fails: fall back to Gemini                  |
|      -> if both fail: 503 + structured error                 |
|                                                              |
|  [5] Response assembled; cache entry stored (if miss)        |
|                                                              |
|  [6] 200 sent to client  <-- response delivered              |
|                                                              |
|  [7] BullMQ job enqueued  (NON-BLOCKING, after response)     |
|      Worker: key_id, model, tokens, cost, latency, status    |
|      -> INSERT into usage_logs (Postgres)                    |
+--------------------------------------------------------------+
```

**Tracing one request end-to-end:**

1. Client sends `POST /v1/chat/completions` with `Authorization: Bearer gw_<raw_key>` and an OpenAI-compatible body `{ model, messages }`.
2. **AuthGuard** computes `sha256(raw_key)`, queries `virtual_keys` by `key_hash`. If no row: `401 Unauthorized`. The full `VirtualKey` entity (id, budgetType, budgetLimit) is attached to the request object for downstream use.
3. **BudgetInterceptor** branches on budget type:
   - `requests`: runs the Redis Lua script — a single atomic round trip that checks and increments. Over budget: `429 Budget Exceeded` before any token is spent.
   - `tokens`/`cost_inr`: non-atomic read-check only. Actual increment happens in the BullMQ worker post-call (since tokens are only known after the provider responds).
4. *(Stretch)* **SemanticCacheService** embeds the normalized prompt text, queries `prompt_cache` by cosine distance. If the nearest-neighbor similarity >= 0.95: return the cached `response_text`, log `cache_hit=true`, increment `hit_count`, skip steps 5–6 entirely.
5. **ProviderService** forwards the request to Groq with an 8-second timeout. On timeout or 5xx: one retry. On second failure: switches to Gemini. On total failure: `503` with `{ error: "all_providers_failed", providers_tried: [...], error_details: [...] }`.
6. Successful provider response assembled into a normalized response object.
7. `200` returned to client immediately.
8. **After** `res.send()` returns, a BullMQ job is enqueued (non-blocking). The BullMQ worker picks it up asynchronously and writes to `usage_logs`. The client is never waiting on this write.

---

## 3. The 5 Most Important Decisions

### Decision 1 — NestJS over raw Express

**Options considered**: Fastify, raw Express, NestJS, Hono (ultra-lightweight TS).

**Why NestJS**: The assignment's required request lifecycle (auth -> budget -> provider -> logging) maps exactly onto NestJS's built-in primitives: Guards -> Interceptors -> Services -> (post-response) event. I've already used this structure in DocSaarthi; I could wire it in hours, not days. Raw Express would work but would require me to re-implement the interceptor chain by hand and add its own complexity surface.

**Tradeoff knowingly accepted**: NestJS is heavier than Express/Hono — cold start is ~200ms slower in a serverless environment. For a long-running Render/Railway dyno (which this is), that's irrelevant. For a Lambda, it'd matter.

---

### Decision 2 — Redis Lua Script for Atomic Budget Enforcement

**Options considered**:
- `SELECT budget_used FROM virtual_keys WHERE ... FOR UPDATE` (Postgres row lock)
- Redis `GET` then `SET` in application code (naive, racy)
- Redis Lua script (atomic, single round-trip)

**What I picked**: Redis Lua script:

```lua
-- KEYS[1] = "budget:<key_id>", ARGV[1] = increment, ARGV[2] = limit
local current = tonumber(redis.call('GET', KEYS[1]) or "0")
local incr    = tonumber(ARGV[1])
local limit   = tonumber(ARGV[2])
if current + incr > limit then
  return -1  -- reject: over budget
else
  redis.call('INCRBY', KEYS[1], incr)
  return current + incr
end
```

**Why it beats the alternatives**: Redis is single-threaded — a Lua script executes atomically with no interleaving from other commands. Two concurrent requests on key `gw_abc` with remaining budget of 1 token: both hit the script simultaneously, Redis serializes them. The first increments to the limit; the second sees `current + incr > limit` and returns `-1`. The naive `GET-then-SET` approach in application code loses this guarantee — a check-then-increment race is trivially reproducible under load.

**Honest scope of the atomicity guarantee**: The Lua script is only used for `requests` budgets. For `tokens` and `cost_inr` budgets, the interceptor does a read-only check (non-atomic), because the actual token count is only known after the provider responds. This is a documented tradeoff — the atomic gate only prevents the worst overconsumption on request-count budgets.

**Tradeoff knowingly accepted**: Redis is now a **second source of truth** for budget_used, separate from the Postgres `virtual_keys.budget_used` column. I mitigate drift with:
- Postgres `budget_used` is the durable/audit source; Redis is the fast gate.
- On key creation, the Redis counter is seeded to 0 immediately (via `redis.set`).
- The BullMQ worker updates both Redis and Postgres after each successful call.
- A Redis restart resets counters to 0 (documented failure mode in Section 9).

**Why not Postgres `SELECT ... FOR UPDATE`?** It works correctly, but it serializes all concurrent requests on the same key at the DB row level. Under bursty traffic, that is a meaningful latency spike. Redis Lua scales better without locks.

---

### Decision 3 — Async Logging via BullMQ (not synchronous Postgres writes)

**Options considered**:
- Synchronous `INSERT INTO usage_logs` before returning the response
- Fire-and-forget `process.nextTick()` (no durability guarantee)
- BullMQ job enqueued post-response, consumed by a worker

**What I picked**: BullMQ post-response enqueue. The `queue.add()` call is a Redis LPUSH — completes in microseconds and is not awaited. The client never waits on this write.

**Specific context from DocSaarthi**: I ran a 14-stage async pipeline on BullMQ in production — file ingestion -> OCR -> chunking -> embedding -> indexing. I hit real backpressure questions (what happens if the worker pool is exhausted?), ordering constraints, and retry semantics. BullMQ's built-in retry-with-backoff meant I didn't have to implement exponential retry in worker code. That experience is directly applicable here.

**Tradeoff knowingly accepted**: If the process crashes between "200 sent" and "job consumed by worker", the usage_log row is lost. The Redis budget counter is still correct (incremented before the call), so the financial gate holds. The audit trail in Postgres has a gap. I'd close this with an **outbox pattern** — write the usage event to a `pending_logs` table inside the same DB transaction as the budget reconciliation — but that's a second weekend's work.

---

### Decision 4 — Non-Streaming Responses Only

**Options considered**: Server-Sent Events (streaming), chunked transfer encoding, non-streaming (blocking response).

**What I picked**: Non-streaming.

**Reasoning**: Streaming responses complicate three things I care about more in this scope:
1. **Budget accounting**: You can't know `tokens_out` until the stream completes. Streaming forces you to either (a) charge a deposit up-front and refund or (b) let the response run and check budget post-hoc — both add meaningful complexity.
2. **Fallback logic**: Switching providers mid-stream is undefined territory. If Groq starts a stream and fails 4 tokens in, what do you send the client? Non-streaming lets me fail cleanly and retry.
3. **Cache logic**: Storing and replaying a streaming response from cache is possible but adds significant engineering surface for a stretch goal.

Non-streaming keeps the entire request lifecycle synchronous and reason-about-able. I state this clearly so an interviewer knows it's a deliberate cut, not an oversight.

---

### Decision 5 — Semantic Caching as the Stretch Goal

**Options considered**: Local Ollama model as provider, request router (cheap vs. capable), semantic caching.

**Why semantic caching**: I already run pgvector + HNSW indexing in DocSaarthi at sub-120ms with cosine similarity search over 1536-dimensional embeddings. The infrastructure cost of adding this stretch is almost zero — I'm reusing a pattern I've already debugged in production. The other stretches (Ollama, router) would have required new debugging time I didn't have.

**Implementation detail**: Only the last user message in the conversation is embedded, not the full message array. Embedding conversation history adds noise and makes the cache too specific to match rephrasings of the same underlying question.

**Cache graceful degradation**: If `EMBEDDING_API_KEY` is not configured, the cache silently disables itself on startup with a warning log. Cache lookup or storage errors are swallowed and logged — they must never fail the primary LLM request.

**What changed vs. DocSaarthi**: In DocSaarthi the vector search is on document chunks (semantic retrieval). Here it's on the last user message (semantic deduplication). The query is the same pgvector HNSW structure, but the intent is different: I want near-duplicate prompts to hit cache, not just topically related content. The higher threshold (0.95 vs. DocSaarthi's 0.75) reflects that.

---

## 4. First-Principles: Why Enforce Budgets at the Gateway?

Because the gateway is the **only component that holds the real provider credential**.

If budget enforcement lived client-side:
- Any caller could simply bypass it — send the request directly to Groq with the gateway key, or modify their client to skip the check.
- "Trusting callers" is not a trust model; it's the absence of one.

The gateway is not just a proxy — it's a **trust boundary**. It's the single chokepoint where money leaves the system. The rule is: enforcement lives where the money is spent, not where the user sits. This is the same principle behind why bank balance checks happen server-side even though the client shows you your balance.

Concretely: if I let callers self-report token usage for billing, they'd under-report. If I enforce client-side only, a misbehaving client can run up a $300 bill before the next sync cycle. The gateway blocks it before the API call is even made.

### Privilege Separation: Admin Token vs. Virtual Keys

A related trust boundary is **privilege separation**:
- **Callers** authenticate strictly with gateway-issued virtual keys (`gw_...`) on `/v1/chat/completions` and `/usage?key=...`. They can run LLM inference and inspect their own spend self-service.
- **Administrators** authenticate with a dedicated static bearer token (`ADMIN_TOKEN`) via `AdminGuard` on `/admin/keys` (`GET` and `POST`).

An open admin endpoint that allows anyone to inspect all virtual keys, budget limits, and tenant metadata is an account-level vulnerability. Gating `/admin/keys` behind `ADMIN_TOKEN` ensures account-level key provisioning and metadata inspection are isolated from caller traffic.

---

## 5. Concurrency: Two Requests on the Same Near-Exhausted Key

**Yes, I handled it.** See Decision 2 (Redis Lua script).

The classic failure mode: key has 1 request remaining. Two requests arrive 2ms apart. Both read `budget_used = 4`, both see `4 + 1 <= 5`, both pass. Budget is now at 6, one over the limit.

**The Lua script eliminates this**: Redis processes commands serially. The first Lua call sees `current=4`, increments to `5`, returns `5`. The second Lua call sees `current=5`, `5 + 1 > 5`, returns `-1` (reject). Exactly one passes, exactly one is rejected. No application-level locking required.

**The alternative I chose not to use**: `SELECT budget_used ... FOR UPDATE` in Postgres. Correct, but it serializes all concurrent requests on the same key at the DB row level. Under load — say 50 concurrent callers sharing one key — that's a 50-deep queue waiting on a lock. Redis Lua scales better.

---

## 6. Fallback Policy

**Policy**: primary call (8s timeout) -> one retry on primary -> switch to Gemini -> if Gemini fails -> 503 fast fail.

**Why this sequence**:
- **One retry on primary**: most provider timeouts are transient (network blip, overloaded edge). A single retry catches ~80% of them cheaply without switching providers.
- **Provider switch, not endless retries**: after two primary failures in a row, it's a real outage. Gemini is structurally different infrastructure, so it's unlikely to have the same failure.
- **Fail fast on total failure**: an open-ended retry loop that keeps a caller waiting 30+ seconds is worse than a clear 503 at second 10. The caller can show a UI error and retry; they can't "un-hang" from a stuck request.
- **Structured error body**: `{ error: "all_providers_failed", providers_tried: ["groq", "gemini"], error_details: [{provider, reason}, ...] }` — the caller knows what was tried and why each failed.

**Gemini schema normalization**: Gemini's request/response schema differs entirely from OpenAI's. The `GeminiAdapter` handles both directions: maps `assistant` role to `model`, lifts `system` messages into `systemInstruction`, normalizes `candidates[0].content.parts[0].text` to `choices[0].message.content`, and maps `usageMetadata.*TokenCount` to `usage.prompt_tokens/completion_tokens`. Edge cases handled: empty candidates (safety filter triggers), missing usageMetadata (error responses).

**What I deliberately didn't build**: a **circuit breaker** that "remembers" a provider is down for N minutes. That's the right thing for production; it requires persistent state + background health polling + half-open recovery logic. Out of scope for this weekend; I'd add it before going live.

---

## 7. What I Deliberately Did NOT Build

| Cut | Why it was deliberate |
|---|---|
| Streaming responses | Adds budget accounting complexity, breaks fallback semantics, complicates caching — all for a UX improvement the assignment doesn't score |
| Multi-tenant auth | Out of scope per the assignment explicitly; requires row-level security and key namespacing |
| Circuit breaker | Right call for production; requires persistent state + background health checks. Needs another week to do well |
| Automated tests | Made a conscious call to integration-test with curl against the deployed URL instead. Would add before any team relied on this service |
| Live provider pings in /health | The `/health` endpoint checks Redis and Postgres but reports provider key configuration status (`configured`/`unconfigured`), not live reachability. Pinging providers on every health check is expensive; failures surface in `usage_logs` instead |
| Multi-admin RBAC / sessions | Admin routes are protected via static bearer token (`ADMIN_TOKEN`). Full multi-user RBAC and session management were cut as out of scope |
| Client-side token counting | Used provider-reported token counts; more accurate for post-call logging at the cost of imprecise pre-call budget estimates for `tokens` type budgets |

---

## 8. The Decision I'm Least Confident About: Similarity Threshold (0.95)

**The decision**: I set the semantic cache similarity threshold at 0.95 (cosine distance).

**Argument for 0.95 (conservative)**:
- Semantically similar != same intent. "What is the capital of France?" and "What is the capital of Paris?" score ~0.93 cosine similarity but mean very different things. At 0.95, most semantically distinct but similarly-phrased prompts don't hit cache.
- Avoids the worst failure mode: returning a cached wrong answer. A cache miss costs money; a cache hit with the wrong answer costs trust.
- For a v1 with no labeled test set, erring conservative is the safer default.

**Argument against 0.95 (for a lower threshold, e.g., 0.85)**:
- At 0.95, repeat queries with minor phrasing variations ("list three benefits of X" vs. "give me 3 benefits of X") don't hit cache despite having identical intent. The hit rate becomes negligible, defeating the purpose.
- In real deployment you'd measure miss rate and tune down; starting at 0.95 might mean the cache does nothing useful for weeks.

**How I'd resolve it with more time**: Build a labeled evaluation set of (prompt_A, prompt_B, same_intent: bool) pairs, plot precision/recall curves across thresholds 0.80–0.99, pick the threshold that maximizes F1(same_intent). The right answer is empirical, not intuitive.

**Additional mitigation**: a config flag `CACHE_CHARGE_ON_HIT` — if true, cache hits still increment the budget counter by a reduced "cache cost" (default 10% of normal). This lets operators decide whether cached responses are "free" or "discounted."

---

## 9. Where It Breaks, and What I'd Do with One More Week

| Scenario | Current behavior | Fix with more time |
|---|---|---|
| Redis restart | Budget counters reset to 0; keys appear to have full budget again | Seed Redis from Postgres `budget_used` on startup; enable `appendonly yes` |
| BullMQ worker crash mid-job | Usage log row lost after 3 exponential-backoff retries | Outbox pattern: write to `pending_logs` Postgres table in same transaction first |
| pgvector index too large | HNSW query time degrades past ~40ms at scale (>1M vectors) | Partition `prompt_cache` by model; tune `ef_search` via `SET LOCAL` |
| Gemini edge cases | Adapter handles empty candidates + missing usageMetadata; other edge cases may exist | Comprehensive tests with recorded Gemini response fixtures |
| Provider key compromise | All upstream access disrupted if env var leaks | Rotate to short-lived credentials via Vault or cloud secret manager |
| tokens/cost_inr budget races | Concurrent requests can both pass a near-exhausted non-requests budget | Use Postgres `SELECT ... FOR UPDATE` or pre-call token estimation |

**With one more week**:
1. Circuit breaker with Redis TTL-based "provider down" flag
2. Redis persistence + seed-on-start from Postgres `budget_used`
3. Outbox pattern for usage_logs durability
4. `/admin/keys/{id}/rotate` endpoint (currently a key must be deleted and recreated)
5. Per-key per-minute rate limiting (burst abuse prevention)
6. Threshold evaluation suite for the semantic cache
7. Granular RBAC and session-based audit tracking (currently gated via static `ADMIN_TOKEN`)

---

## 10. Stack & Deployment Decision

**Railway over AWS/GCP**: I've deployed to AWS (EC2, ECS) in Enalo and ClassMate. For this weekend, Railway gives me a real HTTPS URL, secrets management in the dashboard, automatic deploys from Git, and managed Postgres + Redis add-ons in under 20 minutes. The opportunity cost of setting up ECS + ALB + RDS + ElastiCache is 4–6 hours I would have spent on core features instead. I'd use AWS in a team setting where the infra is already established; I chose Railway because the assignment's time budget makes PaaS the right call — and I think naming that tradeoff is itself a system-design answer, not a weakness.

---

*Total build time: ~13 hours. Time spent on this document: ~45 minutes. I consider them equally important.*
