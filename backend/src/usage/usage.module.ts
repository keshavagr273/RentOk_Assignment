import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { UsageLog } from './usage-log.entity';
import { UsageProcessor } from './usage.processor';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { VirtualKey } from '../auth/virtual-key.entity';
import { BudgetModule } from '../budget/budget.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UsageLog, VirtualKey]),
    BullModule.registerQueue({
      name: 'usage-logging',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,   // Keep last 100 completed jobs for inspection
        removeOnFail: 500,       // Keep last 500 failed jobs for debugging
      },
    }),
    BudgetModule,
  ],
  controllers: [UsageController],
  providers: [UsageProcessor, UsageService],
  exports: [UsageService, BullModule],
})
export class UsageModule {}
