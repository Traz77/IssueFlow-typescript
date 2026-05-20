import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from './entities/ticket.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';

@Injectable()
export class TicketDependenciesService {
  constructor(
    @InjectRepository(TicketDependency)
    private readonly depRepo: Repository<TicketDependency>,
    @InjectRepository(Ticket)
    private readonly ticketsRepo: Repository<Ticket>,
    private readonly auditLog: AuditLogService,
  ) {}

  async addDependency(ticketId: number, blockerId: number, requesterSub: number): Promise<void> {
    const ticket = await this.findActiveTicket(ticketId);
    const blocker = await this.findActiveTicket(blockerId);

    if (ticketId === blockerId) {
      throw new BadRequestException('A ticket cannot block itself');
    }

    if (ticket.projectId !== blocker.projectId) {
      throw new BadRequestException('Dependency tickets must belong to the same project');
    }

    const reverseExists = await this.depRepo.findOneBy({ ticketId: blockerId, blockerId: ticketId });
    if (reverseExists) {
      throw new BadRequestException('Adding this dependency would create a direct cycle');
    }

    const existing = await this.depRepo.findOneBy({ ticketId, blockerId });
    if (existing) {
      throw new BadRequestException('Dependency already exists');
    }

    const dep = this.depRepo.create({ ticketId, blockerId });
    await this.depRepo.save(dep);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.DEPENDENCY_ADDED,
      resourceType: AuditResourceType.TICKET,
      resourceId: ticketId,
      metadata: { blockerId },
    });
  }

  async listDependencies(ticketId: number): Promise<Ticket[]> {
    await this.findActiveTicket(ticketId);
    const deps = await this.depRepo.find({ where: { ticketId } });
    const blockers: Ticket[] = [];
    for (const dep of deps) {
      const blocker = await this.ticketsRepo.findOne({
        where: { id: dep.blockerId, deletedAt: IsNull() },
      });
      if (blocker) blockers.push(blocker);
    }
    return blockers;
  }

  async removeDependency(ticketId: number, blockerId: number, requesterSub: number): Promise<void> {
    const dep = await this.depRepo.findOneBy({ ticketId, blockerId });
    if (!dep) {
      throw new NotFoundException(`Dependency not found`);
    }

    await this.depRepo.remove(dep);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.DEPENDENCY_REMOVED,
      resourceType: AuditResourceType.TICKET,
      resourceId: ticketId,
      metadata: { blockerId },
    });
  }

  async getUnresolvedBlockers(ticketId: number): Promise<number[]> {
    const deps = await this.depRepo.find({ where: { ticketId } });
    if (deps.length === 0) return [];

    const blockerIds = deps.map((d) => d.blockerId);
    const unresolvedIds: number[] = [];

    for (const bid of blockerIds) {
      const blocker = await this.ticketsRepo.findOne({
        where: { id: bid, deletedAt: IsNull() },
      });
      if (!blocker || blocker.status !== TicketStatus.DONE) {
        unresolvedIds.push(bid);
      }
    }

    return unresolvedIds;
  }

  private async findActiveTicket(id: number): Promise<Ticket> {
    const ticket = await this.ticketsRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ticket) throw new NotFoundException(`Ticket #${id} not found`);
    return ticket;
  }
}
