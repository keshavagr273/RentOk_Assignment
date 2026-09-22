import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { VirtualKey } from '../auth/virtual-key.entity';
import { UsageLog } from './usage-log.entity';

/**
 * Usage service — powers the GET /usage endpoint.
 * Looks up a virtual key by hash and returns its usage summary + recent logs.
 */
@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(VirtualKey)
    private readonly virtualKeyRepo: Repository<VirtualKey>,
    @InjectRepository(UsageLog)
    private readonly usageLogRepo: Repository<UsageLog>,
  ) {}

  async getUsage(rawKey: string) {
    // Hash the raw key — same as the auth guard does
    const keyHash = createHash('sha256').update(rawKey.trim()).digest('hex');

    const virtualKey = await this.virtualKeyRepo.findOne({ where: { keyHash } });
    if (!virtualKey) {
      throw new NotFoundException({
        error: 'key_not_found',
        message: 'No virtual key found matching the provided key.',
      });
    }

    // Fetch the 50 most recent usage logs for this key
    const recentLogs = await this.usageLogRepo.find({
      where: { keyId: virtualKey.id },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const totalRequests = recentLogs.length;
    const cacheHits = recentLogs.filter((l) => l.cacheHit).length;
    const cacheHitRate =
      totalRequests > 0
        ? `${((cacheHits / totalRequests) * 100).toFixed(1)}%`
        : '0.0%';

    const budgetUsed = Number(virtualKey.budgetUsed);
    const budgetLimit = Number(virtualKey.budgetLimit);

    return {
      key_name: virtualKey.name,
      budget_type: virtualKey.budgetType,
      budget_limit: budgetLimit,
      budget_used: budgetUsed,
      remaining: Math.max(0, budgetLimit - budgetUsed),
      cache_hits: cacheHits,
      cache_hit_rate: cacheHitRate,
      total_requests: totalRequests,
      recent_requests: recentLogs.map((l) => ({
        created_at: l.createdAt,
        model: l.model,
        provider: l.provider,
        tokens_in: l.tokensIn,
        tokens_out: l.tokensOut,
        cost_estimate_inr: l.costEstimateInr ? Number(l.costEstimateInr) : null,
        latency_ms: l.latencyMs,
        status: l.status,
        cache_hit: l.cacheHit,
      })),
    };
  }
}
