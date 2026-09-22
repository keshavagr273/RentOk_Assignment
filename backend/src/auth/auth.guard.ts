import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { VirtualKey } from './virtual-key.entity';

/**
 * Auth guard that validates the Bearer virtual key on every protected route.
 *
 * Flow:
 *   1. Extract raw key from Authorization header
 *   2. Compute sha256(raw_key)
 *   3. Look up virtual_keys by key_hash
 *   4. If not found → 401
 *   5. If found → attach VirtualKey entity to request for downstream use
 *
 * We NEVER log the raw key. We NEVER compare it to anything stored.
 * The hash is the only thing that touches storage.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectRepository(VirtualKey)
    private readonly virtualKeyRepo: Repository<VirtualKey>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();

    const authHeader: string = request.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: 'missing_auth',
        message: 'Authorization header required: Bearer <virtual_key>',
      });
    }

    // Extract the raw key — never log it
    const rawKey = authHeader.slice('Bearer '.length).trim();
    if (!rawKey) {
      throw new UnauthorizedException({ error: 'empty_key', message: 'Empty bearer token' });
    }

    // Hash it and look up in DB
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const virtualKey = await this.virtualKeyRepo.findOne({ where: { keyHash } });

    if (!virtualKey) {
      throw new UnauthorizedException({
        error: 'invalid_key',
        message: 'Invalid virtual key. Create one via POST /admin/keys',
      });
    }

    // Attach to request for budget interceptor and controller use
    request.virtualKey = virtualKey;
    return true;
  }
}
