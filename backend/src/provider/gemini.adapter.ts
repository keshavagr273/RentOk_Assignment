import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatCompletionRequest,
  ChatMessage,
  NormalizedResponse,
  ProviderError,
} from './provider.types';

/**
 * Gemini provider adapter.
 *
 * Gemini uses a completely different request/response schema from OpenAI.
 * This adapter normalizes both directions so the rest of the gateway
 * is unaware of which provider it's talking to.
 *
 * Key schema differences learned from direct API testing (see AI-LOG.md):
 *
 * Request:
 *   OpenAI: { model, messages: [{ role, content }], stream }
 *   Gemini: { contents: [{ role, parts: [{ text }] }] }
 *   Note: Gemini role for 'assistant' is 'model', not 'assistant'.
 *         System messages are handled via systemInstruction field.
 *
 * Response:
 *   OpenAI: choices[0].message.content + usage.prompt_tokens/completion_tokens
 *   Gemini: candidates[0].content.parts[0].text + usageMetadata.*TokenCount
 *
 * Edge cases handled:
 *   - Empty candidates (safety filter trigger) → empty content, logged as error
 *   - Missing usageMetadata → default to 0 tokens
 */
@Injectable()
export class GeminiAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private readonly config: ConfigService) {}

  async complete(req: ChatCompletionRequest, timeoutMs: number): Promise<NormalizedResponse> {
    const apiKey = this.config.get<string>('app.providers.geminiApiKey');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const model = req.model ?? this.config.get<string>('app.providers.geminiDefaultModel');
    // Gemini uses its own model naming — map common Groq model names to Gemini equivalents
    const geminiModel = this.mapModel(model);

    const { contents, systemInstruction } = this.convertMessages(req.messages);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, any> = { contents };
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const response = await fetch(
        `${this.baseUrl}/models/${geminiModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      clearTimeout(timer);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(no body)');
        const err: ProviderError = {
          provider: 'gemini',
          reason: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
          statusCode: response.status,
        };
        this.logger.warn(`Gemini error: ${err.reason}`);
        throw err;
      }

      const data = await response.json();

      // Edge case: Gemini safety filter may return empty candidates
      if (!data.candidates || data.candidates.length === 0) {
        this.logger.warn('Gemini returned empty candidates (possible safety filter)');
        throw {
          provider: 'gemini',
          reason: 'Empty response (safety filter or model error)',
        } as ProviderError;
      }

      const content = data.candidates[0]?.content?.parts?.[0]?.text ?? '';

      // Gemini response schema normalization
      const usage = data.usageMetadata ?? {};
      return {
        content,
        usage: {
          prompt_tokens: usage.promptTokenCount ?? 0,
          completion_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens:
            (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
        },
        provider: 'gemini',
        status: 'fallback_used',
        model: geminiModel,
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr: ProviderError = { provider: 'gemini', reason: `Timeout after ${timeoutMs}ms` };
        this.logger.warn(`Gemini timed out after ${timeoutMs}ms`);
        throw timeoutErr;
      }
      if (err.provider) throw err;
      throw { provider: 'gemini', reason: err.message ?? 'Network error' } as ProviderError;
    }
  }

  /**
   * Convert OpenAI messages format to Gemini's contents format.
   * - 'system' messages → systemInstruction (separate field)
   * - 'assistant' role → 'model' role (Gemini naming)
   * - 'user' role → 'user' (same)
   */
  private convertMessages(messages: ChatMessage[]): {
    contents: any[];
    systemInstruction?: string;
  } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    const systemInstruction =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n')
        : undefined;

    const contents = conversationMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Gemini requires conversations to start with 'user', not 'model'
    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
    }

    return { contents, systemInstruction };
  }

  /**
   * Map Groq/OpenAI model names to Gemini equivalents.
   * If the model name is already a Gemini model, pass through.
   */
  private mapModel(model: string): string {
    const mapping: Record<string, string> = {
      'llama3-8b-8192':  'gemini-1.5-flash',
      'llama3-70b-8192': 'gemini-1.5-pro',
      'mixtral-8x7b-32768': 'gemini-1.5-flash',
      'gpt-4':           'gemini-1.5-pro',
      'gpt-3.5-turbo':   'gemini-1.5-flash',
    };
    return mapping[model] ?? this.config.get<string>('app.providers.geminiDefaultModel') ?? 'gemini-1.5-flash';
  }
}
