import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { BudgetService } from './budget.service';
import { VirtualKey } from '../auth/virtual-key.entity';

/**
 * Budget interceptor — runs after AuthGuard, before the controller handler.
 *
 * For 'requests' budgets:
 *   Uses the atomic Redis Lua check-and-increment. Two concurrent requests
 *   on a near-exhausted key: exactly one passes, exactly one gets 429.
 *   See DECISIONS.md Decision 2 for the full concurrency analysis.
 *
 * For 'tokens' / 'cost_inr' budgets:
 *   Does a non-atomic read check only (is current < limit?).
 *   Actual token/cost increment happens in the BullMQ worker post-call.
 *   Known tradeoff: concurrent requests can both slip through if budget
 *   is at limit-1. Documented and acceptable for this scope.
 *   For 'requests' budgets (the default), the Lua script is fully atomic.
 */
@Injectable()
export class BudgetInterceptor implements NestInterceptor {
  private readonly logger = new Logger(BudgetInterceptor.name);

  constructor(private readonly budgetService: BudgetService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = ctx.switchToHttp().getRequest();
    const virtualKey: VirtualKey = request.virtualKey;

    if (!virtualKey) {
      // AuthGuard should have run first — this is a misconfiguration
      throw new HttpException('Auth not configured correctly', 500);
    }

    const { id: keyId, budgetType, budgetLimit, name } = virtualKey;
    const limit = Number(budgetLimit);

    if (budgetType === 'requests') {
      // Atomic Lua check-and-increment — handles concurrency correctly
      const result = await this.budgetService.checkAndIncrement(keyId, limit);

      if (result === -1) {
        this.logger.log(`Budget exceeded for key "${name}" (${budgetType}: ${limit})`);
        throw new HttpException(
          {
            error: 'budget_exceeded',
            message: `Budget exhausted for key "${name}"`,
            budget_type: budgetType,
            budget_limit: limit,
            // Not leaking exact usage here — just the limit
          },
          429,
        );
      }

      this.logger.debug(`Budget check passed for key "${name}": ${result}/${limit} requests used`);
    } else {
      // tokens or cost_inr: read-only pre-check
      const within = await this.budgetService.checkOnly(keyId, limit);
      if (!within) {
        this.logger.log(`Budget exceeded for key "${name}" (${budgetType}: ${limit})`);
        throw new HttpException(
          {
            error: 'budget_exceeded',
            message: `Budget exhausted for key "${name}"`,
            budget_type: budgetType,
            budget_limit: limit,
          },
          429,
        );
      }
    }

    return next.handle();
  }
}
