import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  Logger,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsArray, IsNotEmpty, IsString, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../auth/auth.guard';
import { BudgetInterceptor } from '../budget/budget.interceptor';
import { ProviderService } from '../provider/provider.service';
import { SemanticCacheService } from '../cache/cache.service';
import { VirtualKey } from '../auth/virtual-key.entity';
import { UsageJobData } from '../usage/usage.processor';

class MessageDto {
  @IsString()
  @IsNotEmpty()
  role: 'system' | 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content: string;
}

class ChatCompletionDto {
  @IsString()
  @IsOptional()
  model?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];
}

// Cost rates in USD per 1M tokens (input, output)
const COST_RATES: Record<string, [number, number]> = {
  'llama3-8b-8192':    [0.05,  0.08],
  'llama3-70b-8192':   [0.59,  0.79],
  'mixtral-8x7b-32768':[0.24,  0.24],
  'gemini-1.5-flash':  [0.075, 0.30],
  'gemini-1.5-pro':    [3.50,  10.50],
};

function estimateCostInr(
  model: string,
  tokensIn: number,
  tokensOut: number,
  usdToInr: number,
): number {
  const [rateIn, rateOut] = COST_RATES[model] ?? [0.10, 0.10];
  const costUsd = (tokensIn * rateIn + tokensOut * rateOut) / 1_000_000;
  return parseFloat((costUsd * usdToInr).toFixed(6));
}

/**
 * Gateway controller — the primary entry point for all LLM calls.
 *
 * Route: POST /v1/chat/completions
 * Auth:  Authorization: Bearer <virtual_key>
 *
 * Request lifecycle (see DECISIONS.md for full analysis):
 *   [1] AuthGuard → validates key, attaches VirtualKey entity to request
 *   [2] BudgetInterceptor → atomic Redis Lua check (requests) or read-check (tokens/cost)
 *   [3] SemanticCache → pgvector cosine search (if CACHE_ENABLED + EMBEDDING_API_KEY set)
 *   [4] ProviderService → Groq → retry → Gemini → 503
 *   [5] 200 returned to caller
 *   [6] BullMQ job enqueued (fire-and-forget) → usage_logs INSERT
 *
 * The caller never waits on step 6. The queue.add() call is initiated
 * but not awaited — it's a Redis LPUSH which completes in microseconds.
 */
@Controller('v1')
@UseGuards(AuthGuard)
@UseInterceptors(BudgetInterceptor)
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(
    private readonly providerService: ProviderService,
    private readonly cacheService: SemanticCacheService,
    @InjectQueue('usage-logging') private readonly usageQueue: Queue<UsageJobData>,
  ) {}

  @Post('chat/completions')
  @HttpCode(200)
  async chatCompletions(@Body() body: ChatCompletionDto, @Req() req: any) {
    if (!body.messages || body.messages.length === 0) {
      throw new BadRequestException({
        error: 'invalid_request',
        message: 'messages array is required and must not be empty',
      });
    }

    const virtualKey: VirtualKey = req.virtualKey;
    const model = body.model ?? 'llama3-8b-8192';
    const startTime = Date.now();
    const usdToInr = parseFloat(process.env.USD_TO_INR ?? '84');

    // ── [3] Semantic cache check ──────────────────────────────────────────
    let cacheHit = false;
    let responseContent: string;
    let tokensIn = 0;
    let tokensOut = 0;
    let provider = 'groq';
    let status = 'success';
    let actualModel = model;

    if (this.cacheService.isEnabled) {
      const cached = await this.cacheService.findSimilar(body.messages, model);
      if (cached) {
        cacheHit = true;
        responseContent = cached.responseText;
        provider = 'cache';
        status = 'success';
        this.logger.log(`Cache hit — returned cached response (cacheId: ${cached.cacheId})`);
      }
    }

    // ── [4] Provider call (if cache missed) ──────────────────────────────
    if (!cacheHit) {
      const result = await this.providerService.complete({
        model,
        messages: body.messages,
      });

      responseContent = result.content;
      tokensIn = result.usage.prompt_tokens;
      tokensOut = result.usage.completion_tokens;
      provider = result.provider;
      status = result.status;
      actualModel = result.model;

      // Store in cache for future similar requests (non-blocking, errors swallowed)
      if (this.cacheService.isEnabled) {
        this.cacheService
          .store(body.messages, responseContent, model)
          .catch((err) => this.logger.error(`Cache store failed: ${err.message}`));
      }
    }

    const latencyMs = Date.now() - startTime;
    const totalTokens = tokensIn + tokensOut;
    const costEstimateInr = estimateCostInr(actualModel, tokensIn, tokensOut, usdToInr);

    // ── [5] Return response to caller ────────────────────────────────────
    const response = {
      id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: actualModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: responseContent },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: tokensIn,
        completion_tokens: tokensOut,
        total_tokens: totalTokens,
      },
      // Non-standard meta field — callers can use this for observability
      meta: {
        provider,
        latency_ms: latencyMs,
        cache_hit: cacheHit,
      },
    };

    // ── [6] Async usage logging (fire-and-forget) ─────────────────────────
    // queue.add() is a Redis LPUSH — completes in microseconds.
    // We do NOT await it. The response is already prepared above.
    // Caller does not wait for this write.
    const jobData: UsageJobData = {
      keyId: virtualKey.id,
      provider: cacheHit ? 'cache' : provider,
      model: actualModel,
      tokensIn,
      tokensOut,
      costEstimateInr: cacheHit ? 0 : costEstimateInr,
      latencyMs,
      status,
      cacheHit,
      budgetType: virtualKey.budgetType,
      totalTokens,
    };

    this.usageQueue
      .add('log', jobData)
      .catch((err) =>
        this.logger.error(`Failed to enqueue usage log for key ${virtualKey.id}: ${err.message}`),
      );

    return response;
  }
}
