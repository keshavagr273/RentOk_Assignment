import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VirtualKey } from './virtual-key.entity';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminController } from './admin.controller';
import { BudgetModule } from '../budget/budget.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VirtualKey]),
    BudgetModule, // for the Redis provider used by AdminController
  ],
  controllers: [AdminController],
  providers: [AuthGuard, AdminGuard],
  exports: [AuthGuard, AdminGuard, TypeOrmModule], // Export TypeOrmModule so other modules can use VirtualKey repo
})
export class AuthModule {}
