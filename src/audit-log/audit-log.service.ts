import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction, AuditActorType, AuditResourceType } from './audit-action.enum';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface AuditLogParams {
  actorType: AuditActorType;
  actorId: number | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    try {
      const entry = this.auditLogRepo.create({
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata ?? null,
      });
      await this.auditLogRepo.save(entry);
    } catch (err) {
      // A logging failure must never abort the business operation (D9)
      console.error('Audit log write failed', err);
    }
  }

  async query(filter: AuditLogQueryDto): Promise<{
    data: AuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (filter.actorType !== undefined) where.actorType = filter.actorType;
    if (filter.actorId !== undefined) where.actorId = filter.actorId;
    if (filter.action !== undefined) where.action = filter.action;
    if (filter.resourceType !== undefined) where.resourceType = filter.resourceType;
    if (filter.resourceId !== undefined) where.resourceId = filter.resourceId;

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;

    const [data, total] = await this.auditLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { data, total, page, pageSize };
  }
}
