import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqAdapter } from './groq.adapter';
import { GeminiAdapter } from './gemini.adapter';
import {
  ChatCompletionRequest,
  NormalizedResponse,
  ProviderError,
} from './provider.types';

/**
 * Provider service — orchestrates the fallback chain.
 *
 * Policy (see DECISIONS.md Section 6):
 *   1. Call Groq (primary), 8s timeout
 *   2. On timeout/5xx → ONE retry on Groq (handles transient network blips)
 *   3. On second Groq failure → call Gemini (fallback)
 *   4. On Gemini failure → 503 with structured error body
 *
 * Why fail fast instead of retrying indefinitely:
 *   A caller waiting on a hung request cannot recover gracefully.
 *   A fast 503 lets the caller retry or show a clean error.
 *   An open-ended retry loop that keeps the caller waiting 30+ seconds is worse.
 *
 * What was deliberately NOT built:
 *   Circuit breaker that "remembers" a provider is down for N minutes.
 *   That requires persistent TTL state + health-check polling + half-open recovery.
 *   Would add with one more week. Named in DECISIONS.md.
 */
@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    private readonly groq: GroqAdapter,
    private readonly gemini: GeminiAdapter,
    private readonly config: ConfigService,
  ) {}

  async complete(req: ChatCompletionRequest): Promise<NormalizedResponse> {
    const timeoutMs = this.config.get<number>('app.providers.timeoutMs') ?? 8000;
    const errors: ProviderError[] = [];

    // ── Step 1: Groq primary call ─────────────────────────────────────────
    try {
      const result = await this.groq.complete(req, timeoutMs);
      this.logger.debug(`Groq success: ${result.usage.total_tokens} tokens`);
      return { ...result, status: 'success' };
    } catch (err: any) {
      this.logger.warn(`Groq primary failed: ${err.reason ?? err.message}`);
      errors.push(err as ProviderError);
    }

    // ── Step 2: One retry on Groq (transient error assumption) ────────────
    try {
      this.logger.log('Retrying Groq (attempt 2/2)…');
      const result = await this.groq.complete(req, timeoutMs);
      this.logger.log('Groq retry succeeded');
      return { ...result, status: 'success' };
    } catch (err: any) {
      this.logger.warn(`Groq retry also failed: ${err.reason ?? err.message}`);
      errors.push(err as ProviderError);
    }

    // ── Step 3: Gemini fallback ───────────────────────────────────────────
    try {
      this.logger.log('Switching to Gemini fallback…');
      const result = await this.gemini.complete(req, timeoutMs);
      this.logger.log('Gemini fallback succeeded');
      return { ...result, status: 'fallback_used' };
    } catch (err: any) {
      this.logger.warn(`Gemini fallback also failed: ${err.reason ?? err.message}`);
      errors.push(err as ProviderError);
    }

    // ── Step 4: All providers failed — fail fast with structured 503 ──────
    this.logger.error(
      `All providers failed. Errors: ${errors.map((e) => `${e.provider}: ${e.reason}`).join(' | ')}`,
    );

    throw new ServiceUnavailableException({
      error: 'all_providers_failed',
      message: 'All LLM providers failed. Please retry in a moment.',
      providers_tried: errors.map((e) => e.provider),
      error_details: errors.map((e) => ({ provider: e.provider, reason: e.reason })),
    });
  }

  /**
   * Ping a provider to check reachability (used by /health endpoint).
   * Returns latency in ms if reachable, null if unreachable.
   */
  async pingGroq(): Promise<number | null> {
    try {
      const start = Date.now();
      await this.groq.complete(
        { model: 'llama3-8b-8192', messages: [{ role: 'user', content: 'Hi' }] },
        3000,
      );
      return Date.now() - start;
    } catch {
      return null;
    }
  }

  async pingGemini(): Promise<number | null> {
    try {
      const start = Date.now();
      await this.gemini.complete(
        { model: 'gemini-1.5-flash', messages: [{ role: 'user', content: 'Hi' }] },
        3000,
      );
      return Date.now() - start;
    } catch {
      return null;
    }
  }
}
