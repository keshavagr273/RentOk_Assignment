import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsIn, IsNotEmpty, IsNumber, IsPositive, IsString, Min } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { VirtualKey } from './virtual-key.entity';
import { REDIS_CLIENT } from '../budget/budget.module';
import Redis from 'ioredis';

class CreateKeyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['requests', 'tokens', 'cost_inr'])
  budget_type: string;

  @IsNumber()
  @IsPositive()
  @Min(1)
  budget_limit: number;
}

/**
 * Admin controller — not auth-protected (by design for this scope).
 * In production, this would require admin-only auth (e.g. a separate admin key).
 *
 * POST /admin/keys — create a virtual key (returns raw key ONCE)
 * GET  /admin/keys — list all virtual keys (for the admin dashboard)
 */
@Controller('admin')
export class AdminController {
  constructor(
    @InjectRepository(VirtualKey)
    private readonly virtualKeyRepo: Repository<VirtualKey>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Post('keys')
  @HttpCode(201)
  async createKey(@Body() dto: CreateKeyDto) {
    if (!dto.name || !dto.budget_type || !dto.budget_limit) {
      throw new BadRequestException('name, budget_type, and budget_limit are required');
    }

    // Generate a cryptographically secure random key
    // Format: gw_ + 32 hex chars = 35 chars total, easy to identify in logs
    const rawKey = 'gw_' + randomBytes(16).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const entity = this.virtualKeyRepo.create({
      keyHash,
      name: dto.name,
      budgetType: dto.budget_type,
      budgetLimit: dto.budget_limit,
      budgetUsed: 0,
    });

    const saved = await this.virtualKeyRepo.save(entity);

    // Seed the Redis budget counter so it's available immediately
    // (avoids needing a Postgres fallback on first request)
    await this.redis.set(`budget:${saved.id}`, '0');

    return {
      key: rawKey, // ← Raw key returned ONCE. We do not store it.
      id: saved.id,
      name: saved.name,
      budget_type: saved.budgetType,
      budget_limit: Number(saved.budgetLimit),
      budget_used: 0,
      warning: 'This is the only time the raw key will be shown. Store it securely.',
    };
  }

  @Get('keys')
  async listKeys() {
    const keys = await this.virtualKeyRepo.find({
      order: { createdAt: 'DESC' },
    });

    // Return key metadata — NEVER the key_hash (that's an internal implementation detail)
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      budget_type: k.budgetType,
      budget_limit: Number(k.budgetLimit),
      budget_used: Number(k.budgetUsed),
      created_at: k.createdAt,
    }));
  }
}
