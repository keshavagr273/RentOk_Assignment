import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './budget.module';

/**
 * Budget enforcement service.
 *
 * Uses Redis for atomic, low-latency budget checks.
 * Redis is the fast enforcement gate; Postgres is the durable audit record.
 *
 * The Lua script ensures atomicity — see DECISIONS.md Decision 2 for the
 * full race condition analysis (why GET-then-SET is broken under concurrency).
 */
@Injectable()
export class BudgetService implements OnModuleInit {
  private readonly logger = new Logger(BudgetService.name);

  /**
   * Redis Lua script: atomic check-and-increment.
   *
   * KEYS[1] = "budget:<key_id>"
   * ARGV[1] = increment amount
   * ARGV[2] = budget limit
   *
   * Returns:
   *   -1   → over budget (reject)
   *   >= 0 → new total (accepted)
   *
   * This runs in a single Redis round-trip with no interleaving.
   * Two concurrent requests on a near-exhausted key: Redis serializes
   * the Lua calls. First call increments; second call sees updated value
   * and returns -1. Exactly one passes, exactly one is rejected.
   */
  private readonly LUA_CHECK_INCR = `
    local current = tonumber(redis.call('GET', KEYS[1]) or "0")
    local incr    = tonumber(ARGV[1])
    local limit   = tonumber(ARGV[2])
    if current + incr > limit then
      return -1
    else
      redis.call('INCRBY', KEYS[1], incr)
      return current + incr
    end
  `;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('BudgetService initialized — Redis Lua budget enforcement active');
  }

  /**
   * Atomically check and increment budget for 'requests' type budgets.
   * Returns the new total if accepted, -1 if over budget.
   *
   * For 'tokens' and 'cost_inr' budgets, use checkOnly() instead.
   * See DECISIONS.md Decision 2 for the full trade-off explanation.
   */
  async checkAndIncrement(keyId: string, budgetLimit: number): Promise<number> {
    const redisKey = `budget:${keyId}`;

    // Seed counter from 0 if it doesn't exist yet (e.g., after Redis restart)
    // The definitive value lives in Postgres; this is just initialization
    const exists = await this.redis.exists(redisKey);
    if (!exists) {
      this.logger.warn(`Budget key ${redisKey} not in Redis — seeding from 0. If this persists, check Redis persistence config.`);
      await this.redis.set(redisKey, '0');
    }

    const result = await this.redis.eval(
      this.LUA_CHECK_INCR,
      1,          // number of KEYS
      redisKey,   // KEYS[1]
      '1',        // ARGV[1]: increment = 1 request
      String(budgetLimit), // ARGV[2]: limit
    ) as number;

    return result;
  }

  /**
   * Read-only budget check for token/cost budgets.
   * Returns true if the key is within budget, false if exhausted.
   *
   * Non-atomic: two concurrent requests can both pass if the budget is at limit-1.
   * Documented tradeoff: acceptable for tokens/cost_inr budgets at this scope.
   * For 'requests' budgets, use checkAndIncrement() for atomic enforcement.
   */
  async checkOnly(keyId: string, budgetLimit: number): Promise<boolean> {
    const current = await this.redis.get(`budget:${keyId}`);
    return parseFloat(current ?? '0') < budgetLimit;
  }

  /**
   * Increment the Redis budget counter by an arbitrary amount.
   * Called by the BullMQ worker after a successful provider call
   * to sync actual token/cost usage into Redis.
   */
  async incrementBy(keyId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    // Use INCRBYFLOAT for fractional amounts (cost_inr)
    await this.redis.incrbyfloat(`budget:${keyId}`, amount);
  }

  /**
   * Get the current Redis budget counter value.
   */
  async getCurrentUsage(keyId: string): Promise<number> {
    const val = await this.redis.get(`budget:${keyId}`);
    return parseFloat(val ?? '0');
  }

  /**
   * Seed the Redis counter from a known value (e.g., on key creation or restart).
   */
  async seedCounter(keyId: string, value: number): Promise<void> {
    await this.redis.set(`budget:${keyId}`, String(value));
  }
}
