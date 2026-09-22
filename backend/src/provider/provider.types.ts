/**
 * Shared types for provider adapters and the provider service.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
}

export interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Normalized response from any provider — OpenAI-compatible format */
export interface NormalizedResponse {
  content: string;
  usage: NormalizedUsage;
  provider: 'groq' | 'gemini';
  /** success | fallback_used | error */
  status: string;
  model: string;
}

export interface ProviderError {
  provider: string;
  reason: string;
  statusCode?: number;
}
