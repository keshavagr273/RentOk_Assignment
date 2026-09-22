import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Virtual keys issued by the gateway.
 *
 * SECURITY: We NEVER store the raw key.
 * Only the SHA-256 hash of the raw key is stored.
 * The raw key is returned exactly once at creation time.
 * If a key is lost, it must be regenerated.
 */
@Entity('virtual_keys')
export class VirtualKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** sha256(raw_key) — the raw key is never stored */
  @Column({ name: 'key_hash', unique: true })
  keyHash: string;

  @Column()
  name: string;

  /** 'requests' | 'tokens' | 'cost_inr' */
  @Column({ name: 'budget_type' })
  budgetType: string;

  @Column({ name: 'budget_limit', type: 'numeric' })
  budgetLimit: number;

  /**
   * Durable audit record of usage.
   * Redis is the fast enforcement gate; this is the source of truth for /usage history.
   */
  @Column({ name: 'budget_used', type: 'numeric', default: 0 })
  budgetUsed: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
