import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * GET /usage?key=<raw_virtual_key>
 *
 * Returns usage statistics for the given virtual key.
 * The key is hashed server-side before the DB lookup — same as AuthGuard.
 */
@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  async getUsage(@Query('key') rawKey: string) {
    if (!rawKey || rawKey.trim() === '') {
      throw new BadRequestException({
        error: 'missing_key',
        message: 'Query parameter ?key=<virtual_key> is required',
      });
    }
    return this.usageService.getUsage(rawKey);
  }
}
