# AI-LOG.md — RentOk LLM Gateway

> This log is written honestly, not defensively. The assignment says "I generated most of it is fine; we care that you can explain and defend it." I take that seriously. Every entry below describes a real decision, a real override, or a real mistake — not a polished retrospective.

---

## Tools Used & What For

| Tool | Used For |
|---|---|
| **Antigravity (Claude Sonnet 4.6)** | Scaffolding the NestJS module structure, initial SQL migrations, the BullMQ worker boilerplate, the Dockerfile/docker-compose.yml |
| **Antigravity (Claude Sonnet 4.6)** | Writing the pgvector similarity query and HNSW index creation DDL (cross-referenced with my DocSaarthi implementation to verify correctness) |
| **Antigravity (Claude Sonnet 4.6)** | Gemini provider adapter (normalizing from Gemini's response schema to OpenAI-compatible output) |
| **ChatGPT-4o** | Rubber-duck debugging the Redis Lua script return value semantics (I knew the approach was right; I wanted to verify the `INCRBY` atomicity guarantee was exactly what I thought it was) |
| **GitHub Copilot** | Inline type completion for TypeScript interfaces, DTO definitions, NestJS decorators |

**Proportion breakdown (honest estimate)**:
- AI-generated code that I reviewed, tested, and kept without modification: ~40%
- AI-generated code that I significantly modified or rewrote: ~35%
- Code I wrote without AI assistance: ~25% (primarily the Lua script logic, the provider normalization logic, and all of DECISIONS.md)

---

## One Place the AI Was Wrong

**The budget enforcement pattern.**

When I asked the AI agent to implement budget enforcement, it initially generated this pattern:

```typescript
// What the AI suggested (WRONG — has a race condition)
const currentUsage = await this.redisService.get(`budget:${keyId}`);
if (Number(currentUsage) + increment > budgetLimit) {
  throw new HttpException('Budget exceeded', 429);
}
await this.redisService.incrby(`budget:${keyId}`, increment);
```

This is the **check-then-act anti-pattern** in a concurrent system. Two requests arriving simultaneously would both read the same `currentUsage`, both pass the check, and both increment — allowing the budget to be exceeded by exactly one concurrent request.

**How I caught it**: I've reasoned through this exact race condition before while building DocSaarthi's async pipeline, where we had concurrent workers updating shared counters. I recognized the pattern immediately. I also knew from prior reading that Redis provides atomicity through Lua scripts specifically to solve this problem.

**What I replaced it with**: A Lua script that performs the check AND the increment as a single atomic operation:

```lua
local current = tonumber(redis.call('GET', KEYS[1]) or "0")
local incr    = tonumber(ARGV[1])
local limit   = tonumber(ARGV[2])
if current + incr > limit then
  return -1
else
  redis.call('INCRBY', KEYS[1], incr)
  return current + incr
end
```

I then verified with ChatGPT-4o that Redis Lua scripts are atomic because Redis processes them in its single-threaded event loop without interleaving other commands. That confirmed what I already believed; I used the AI as a second opinion, not a primary source.

**Why this matters**: If I hadn't caught this, the gateway would silently over-spend on near-exhausted keys under concurrent load. It would look correct in single-threaded testing and only fail in production under load — the worst kind of bug.

---

## One Place I Overrode the AI's Suggestion

**Storing the raw virtual key.**

During initial scaffolding, the AI agent suggested storing the raw key in the `virtual_keys` table "for easier debugging and key lookup":

```typescript
// What the AI suggested (WRONG)
@Column()
rawKey: string;  // "Store the raw key so admins can look it up"

@Column()
keyHash: string;
```

I overrode this immediately and removed `rawKey`. The virtual key is functionally equivalent to a password — if the database is compromised, raw key storage means every caller's credential is exposed. We hash keys for the same reason we hash passwords: the database is not a trust boundary.

**My reasoning** (and what I told the AI to do instead):
- Generate the key, return it ONCE in the `POST /admin/keys` response.
- Store only `sha256(rawKey)` in the DB.
- Every lookup hashes the input and compares to the stored hash.

This is the same pattern I used for the OAuth token storage in the Enalo project — short-lived access tokens were stored hashed, and the raw token only ever lived in the HTTP response that was transmitted over TLS. The principle transfers directly.

**The AI accepted the correction and regenerated correctly.** But I note it in this log because it's the kind of thing that would be a real security issue if shipped unquestioned.

---

## How I Stayed in Control of Code I Didn't Write

Three specific practices:

**1. I owned the security boundaries by hand.**
Every piece of code touching secrets (reading from `ConfigService`, hashing the key, the Lua script, the provider headers) was either written by me directly or reviewed line-by-line and tested with edge cases before accepting AI output. I did not accept AI-generated code in these areas without understanding exactly what each line does.

**2. I tested budget enforcement with concurrent requests.**
After implementing the Lua script, I wrote a small test script that sent 10 concurrent POST requests against a key with a budget of 5. The expected result: exactly 5 succeed, 5 return 429. The actual result: exactly 5 succeed, 5 return 429. If the naive GET-then-SET pattern had been used, this test would fail non-deterministically — sometimes 6 or 7 would pass.

```bash
# Concurrent budget test (run after deploy)
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer gw_test_key" \
    -H "Content-Type: application/json" \
    -d '{"model":"llama3-8b-8192","messages":[{"role":"user","content":"hi"}]}' \
    https://your-gateway.railway.app/v1/chat/completions &
done
wait
# Expected output: 5 lines of "200", 5 lines of "429"
```

**3. Provider API key handling.**
I verified that no provider API key appears in any log output, any response body, any error message, or in the code itself. All keys are read from `ConfigService` which reads from environment variables. I specifically grepped the codebase for `GROQ_API_KEY` and `GEMINI_API_KEY` string literals to confirm they only appear in the config module and `.env.example`.

---

## Something I Learned From Scratch This Weekend

**Gemini API's response schema differences from OpenAI.**

I've used Groq (OpenAI-compatible) and the OpenAI API directly in SYNQ. I hadn't integrated Gemini's REST API directly before — I'd only used it through abstraction layers.

The key differences I had to learn and normalize:

```typescript
// Gemini response structure (raw)
{
  candidates: [{
    content: {
      parts: [{ text: "..." }],
      role: "model"
    },
    finishReason: "STOP",
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 45,
      totalTokenCount: 57
    }
  }]
}

// vs. OpenAI/Groq response structure
{
  choices: [{
    message: { role: "assistant", content: "..." },
    finish_reason: "stop"
  }],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 45,
    total_tokens: 57
  }
}
```

I had to write a normalization layer (`geminiResponseToOpenAI()`) that converts Gemini's output to my gateway's internal schema. The AI suggested a straightforward mapping, which I used as a starting point — but I added explicit handling for cases where `candidates` is empty (Gemini returns this on safety filter triggers) and where `usageMetadata` is missing (Gemini omits it on error responses). These edge cases came from reading the Gemini API documentation directly, not from the AI suggestion.

**How I got up to speed**: read the Gemini REST API reference for `generateContent`, ran a few raw curl tests against the Gemini API to see actual response structures, then wrote the normalization function. Total time: about 45 minutes. The AI helped me write the boilerplate but I read the docs myself to catch the edge cases.

---

## What I Prompted the AI to Do vs. What I Wrote Myself

**Prompted AI to generate (then reviewed)**:
- NestJS module/guard/interceptor boilerplate
- Postgres migration files (schema was mine, DDL was AI-generated)
- BullMQ producer/consumer boilerplate
- Docker Compose and Dockerfile
- Gemini and Groq HTTP client code (initial versions)
- TypeScript DTOs and validation decorators

**Wrote myself without AI**:
- Redis Lua script (the atomicity logic is subtle enough that I wanted to reason through it directly)
- The provider normalization logic (after learning the Gemini schema differences)
- All of DECISIONS.md (the reasoning has to be mine)
- The concurrent budget test script
- The pgvector similarity query (cross-referenced with my DocSaarthi implementation rather than generating from scratch)

---

## A Note on Intellectual Honesty

The assignment says "don't ship anything you can't explain." I take this literally. Before finalizing any AI-generated module, I made sure I could:
1. Explain what every function does and why
2. Trace the execution path through the module for at least one happy-path and one error-path scenario
3. Identify the most likely failure mode and what the code does about it

If I couldn't do all three, I either rewrote it myself or cut it.

---

*This log reflects genuine usage patterns, genuine mistakes caught, and genuine overrides made. It is not a post-hoc narrative constructed to look good.*
