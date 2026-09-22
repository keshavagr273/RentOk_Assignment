import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { VirtualKey } from '../auth/virtual-key.entity';

/**
 * Immutable audit log of every request that passed authentication.
 * Written asynchronously by the BullMQ worker post-response.
 *
 * status values:
 *   'success'         — provider responded OK
 *   'fallback_used'   — primary failed, fallback responded
 *   'rejected_budget' — budget exhausted (BudgetInterceptor rejected)
 *   'error'           — all providers failed (503 returned)
 */
@Entity('usage_logs')
export class UsageLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'key_id', nullable: true })
  keyId: string;

  @ManyToOne(() => VirtualKey, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'key_id' })
  virtualKey: VirtualKey;

  @Column()
  provider: string;

  @Column()
  model: string;

  @Column({ name: 'tokens_in', nullable: true, type: 'int' })
  tokensIn: number;

  @Column({ name: 'tokens_out', nullable: true, type: 'int' })
  tokensOut: number;

  @Column({ name: 'cost_estimate_inr', nullable: true, type: 'numeric', precision: 10, scale: 6 })
  costEstimateInr: number;

  @Column({ name: 'latency_ms', nullable: true, type: 'int' })
  latencyMs: number;

  /** success | fallback_used | rejected_budget | error */
  @Column()
  status: string;

  @Column({ name: 'cache_hit', default: false })
  cacheHit: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
