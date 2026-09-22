import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatCompletionRequest,
  NormalizedResponse,
  ProviderError,
} from './provider.types';

/**
 * Groq provider adapter.
 *
 * Groq uses an OpenAI-compatible API schema, so the request and response
 * mapping is straightforward. The main difference is the base URL and
 * the available models (llama3-8b-8192 is the free default).
 *
 * We force stream: false — see DECISIONS.md Decision 4 for the rationale
 * (budget accounting + fallback logic are simpler with non-streaming responses).
 */
@Injectable()
export class GroqAdapter {
  private readonly logger = new Logger(GroqAdapter.name);
  private readonly baseUrl = 'https://api.groq.com/openai/v1';

  constructor(private readonly config: ConfigService) {}

  async complete(req: ChatCompletionRequest, timeoutMs: number): Promise<NormalizedResponse> {
    const apiKey = this.config.get<string>('app.providers.groqApiKey');
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const model = req.model ?? this.config.get<string>('app.providers.groqDefaultModel');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // API key only in headers — never logged, never in body, never in response
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: req.messages,
          stream: false, // Non-streaming by design — see DECISIONS.md Decision 4
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(no body)');
        const err: ProviderError = {
          provider: 'groq',
          reason: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
          statusCode: response.status,
        };
        this.logger.warn(`Groq error: ${err.reason}`);
        throw err;
      }

      const data = await response.json();

      // Groq returns OpenAI-compatible format — minimal normalization needed
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        usage: {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0,
        },
        provider: 'groq',
        status: 'success',
        model: data.model ?? model,
      };
    } catch (err: any) {
      clearTimeout(timer);
      // AbortError means timeout
      if (err.name === 'AbortError') {
        const timeoutErr: ProviderError = {
          provider: 'groq',
          reason: `Timeout after ${timeoutMs}ms`,
        };
        this.logger.warn(`Groq timed out after ${timeoutMs}ms`);
        throw timeoutErr;
      }
      // Re-throw ProviderError objects as-is
      if (err.provider) throw err;
      // Wrap network errors
      throw { provider: 'groq', reason: err.message ?? 'Network error' } as ProviderError;
    }
  }
}
