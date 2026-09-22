import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { UsageLog } from './usage-log.entity';
import { VirtualKey } from '../auth/virtual-key.entity';
import { BudgetService } from '../budget/budget.service';

export interface UsageJobData {
  keyId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEstimateInr: number;
  latencyMs: number;
  status: string;
  cacheHit: boolean;
  budgetType: string;
  totalTokens: number;
}

/**
 * BullMQ worker: processes usage logging jobs asynchronously.
 *
 * This runs AFTER the response has already been sent to the caller.
 * The caller never waits on this write — it's purely async.
 *
 * What this worker does:
 *   1. Insert a row into usage_logs (durable audit record in Postgres)
 *   2. Update virtual_keys.budget_used with actual usage (Postgres audit source)
 *   3. For tokens/cost_inr budgets: sync Redis counter with actual usage
 *
 * On failure: BullMQ retries with exponential backoff (3 attempts).
 * Known gap: if all retries fail, the log row is lost. See DECISIONS.md
 * "Where It Breaks" section — outbox pattern would close this.
 */
@Processor('usage-logging')
export class UsageProcessor extends WorkerHost {
  private readonly logger = new Logger(UsageProcessor.name);

  constructor(
    @InjectRepository(UsageLog)
    private readonly usageLogRepo: Repository<UsageLog>,
    @InjectRepository(VirtualKey)
    private readonly virtualKeyRepo: Repository<VirtualKey>,
    private readonly budgetService: BudgetService,
  ) {
    super();
  }

  async process(job: Job<UsageJobData>): Promise<void> {
    const {
      keyId,
      provider,
      model,
      tokensIn,
      tokensOut,
      costEstimateInr,
      latencyMs,
      status,
      cacheHit,
      budgetType,
      totalTokens,
    } = job.data;

    // 1. Insert usage log row (durable audit record)
    const log = this.usageLogRepo.create({
      keyId,
      provider,
      model,
      tokensIn: tokensIn ?? 0,
      tokensOut: tokensOut ?? 0,
      costEstimateInr: costEstimateInr ?? 0,
      latencyMs: latencyMs ?? 0,
      status,
      cacheHit: cacheHit ?? false,
    });
    await this.usageLogRepo.save(log);

    // 2. Update Postgres budget_used (durable audit source)
    // Only update for successful requests — rejected_budget rows don't consume budget
    if (status === 'success' || status === 'fallback_used') {
      let budgetIncrement = 0;

      if (budgetType === 'requests') {
        budgetIncrement = 1;
      } else if (budgetType === 'tokens') {
        budgetIncrement = totalTokens ?? 0;
      } else if (budgetType === 'cost_inr') {
        budgetIncrement = costEstimateInr ?? 0;
      }

      if (budgetIncrement > 0) {
        // Update Postgres (durable record)
        await this.virtualKeyRepo
          .createQueryBuilder()
          .update(VirtualKey)
          .set({ budgetUsed: () => `budget_used + ${budgetIncrement}` })
          .where('id = :id', { id: keyId })
          .execute();

        // Sync Redis for tokens/cost_inr budgets
        // (requests budget was already incremented atomically by BudgetInterceptor)
        if (budgetType === 'tokens' || budgetType === 'cost_inr') {
          await this.budgetService.incrementBy(keyId, budgetIncrement);
        }
      }
    }

    this.logger.debug(
      `Logged: key=${keyId} provider=${provider} status=${status} ` +
      `tokens=${tokensIn}/${tokensOut} cost=₹${costEstimateInr?.toFixed(4)}`,
    );
  }
}
