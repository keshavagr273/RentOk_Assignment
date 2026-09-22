import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GatewayController } from './gateway.controller';
import { ProviderModule } from '../provider/provider.module';
import { CacheModule } from '../cache/cache.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';

@Module({
  imports: [
    AuthModule,
    BudgetModule,
    ProviderModule,
    CacheModule,
    // Register the queue for injection in the controller
    BullModule.registerQueue({ name: 'usage-logging' }),
  ],
  controllers: [GatewayController],
})
export class GatewayModule {}
