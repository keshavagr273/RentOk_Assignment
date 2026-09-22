import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Admin guard that validates a static Bearer token on /admin routes.
 *
 * Enforces privilege separation between:
 * - Callers: authenticate with virtual keys (gw_...) on /v1/chat/completions & /usage
 * - Administrators: authenticate with ADMIN_TOKEN on /admin/keys (GET/POST)
 *
 * Accepts either:
 * - Authorization: Bearer <ADMIN_TOKEN>
 * - x-admin-token: <ADMIN_TOKEN>
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest();

    const expectedToken =
      this.configService.get<string>('app.adminToken') ||
      process.env.ADMIN_TOKEN;

    if (!expectedToken) {
      throw new UnauthorizedException({
        error: 'admin_auth_not_configured',
        message: 'ADMIN_TOKEN is not configured on the server',
      });
    }

    const authHeader: string = request.headers['authorization'] ?? '';
    let providedToken = '';

    if (authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice('Bearer '.length).trim();
    } else if (request.headers['x-admin-token']) {
      providedToken = String(request.headers['x-admin-token']).trim();
    }

    if (!providedToken || providedToken !== expectedToken) {
      throw new UnauthorizedException({
        error: 'unauthorized_admin',
        message: 'Invalid or missing admin token. Provide Authorization: Bearer <ADMIN_TOKEN>',
      });
    }

    return true;
  }
}
