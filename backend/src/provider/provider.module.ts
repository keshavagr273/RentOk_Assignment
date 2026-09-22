import { Module } from '@nestjs/common';
import { GroqAdapter } from './groq.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { ProviderService } from './provider.service';

@Module({
  providers: [GroqAdapter, GeminiAdapter, ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
