import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-action.enum';

@Entity('audit_logs')
@Index(['resourceType', 'resourceId'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'actor_type', type: 'enum', enum: AuditActorType })
  actorType: AuditActorType;

  @Index()
  @Column({ name: 'actor_id', nullable: true })
  actorId: number | null;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ name: 'resource_type', type: 'enum', enum: AuditResourceType })
  resourceType: AuditResourceType;

  @Column({ name: 'resource_id' })
  resourceId: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
