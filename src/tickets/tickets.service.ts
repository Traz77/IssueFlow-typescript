import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Ticket } from './entities/ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { TicketDependenciesService } from './ticket-dependencies.service';
import { isValidTransition } from './status-transitions';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';
import { WorkloadService } from './workload.service';

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketsRepo: Repository<Ticket>,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    private readonly ticketDependencies: TicketDependenciesService,
    private readonly auditLog: AuditLogService,
    private readonly workloadService: WorkloadService,
  ) {}

  async findAllByProject(projectId: number): Promise<TicketResponseDto[]> {
    await this.projectsService.findOne(projectId);
    const tickets = await this.ticketsRepo.find({
      where: { projectId, deletedAt: IsNull() },
    });
    return tickets.map(TicketResponseDto.from);
  }

  async findOne(id: number): Promise<TicketResponseDto> {
    return TicketResponseDto.from(await this.findOneRaw(id));
  }

  async create(dto: CreateTicketDto, requesterSub: number): Promise<TicketResponseDto> {
    try {
      await this.projectsService.findOne(dto.projectId);
    } catch {
      throw new BadRequestException('Project does not exist');
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== null) {
      try {
        await this.usersService.findOne(dto.assigneeId);
      } catch {
        throw new BadRequestException('Assignee user does not exist');
      }
    }

    const shouldAutoAssign = dto.assigneeId === undefined;
    const resolvedAssigneeId: number | null = shouldAutoAssign
      ? await this.workloadService.pickAutoAssignee(dto.projectId)
      : (dto.assigneeId ?? null);

    const ticket = this.ticketsRepo.create({
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status,
      priority: dto.priority,
      type: dto.type,
      projectId: dto.projectId,
      assigneeId: resolvedAssigneeId,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });

    const saved = await this.ticketsRepo.save(ticket);

    if (shouldAutoAssign && resolvedAssigneeId !== null) {
      await this.auditLog.log({
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.AUTO_ASSIGN,
        resourceType: AuditResourceType.TICKET,
        resourceId: saved.id,
        metadata: { assignedUserId: resolvedAssigneeId, projectId: dto.projectId },
      });
    }

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.TICKET_CREATED,
      resourceType: AuditResourceType.TICKET,
      resourceId: saved.id,
      metadata: {
        title: dto.title,
        projectId: dto.projectId,
        status: dto.status,
        priority: dto.priority,
        type: dto.type,
        assigneeId: resolvedAssigneeId,
      },
    });

    return TicketResponseDto.from(saved);
  }

  async update(id: number, dto: UpdateTicketDto, requesterSub: number): Promise<void> {
    const ticket = await this.findOneRaw(id);

    if (ticket.status === TicketStatus.DONE) {
      throw new ConflictException('Ticket is DONE and cannot be modified');
    }

    if (dto.version !== ticket.version) {
      throw new ConflictException(
        'Ticket was modified by another request; refresh and retry',
      );
    }

    if (dto.status !== undefined && dto.status !== ticket.status) {
      if (!isValidTransition(ticket.status, dto.status)) {
        throw new BadRequestException(
          `Invalid status transition from ${ticket.status} to ${dto.status}`,
        );
      }

      if (dto.status === TicketStatus.DONE) {
        const blockers = await this.ticketDependencies.getUnresolvedBlockers(id);
        if (blockers.length > 0) {
          throw new ConflictException(
            `Cannot mark ticket as DONE; unresolved blockers: ${blockers.join(', ')}`,
          );
        }
      }
    }

    if (dto.assigneeId !== undefined) {
      try {
        await this.usersService.findOne(dto.assigneeId);
      } catch {
        throw new BadRequestException('Assignee user does not exist');
      }
    }

    // Collect what changed for the audit record before applying
    const changes: Record<string, unknown> = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.description !== undefined) changes.description = dto.description;
    if (dto.status !== undefined && dto.status !== ticket.status) {
      changes.status = { from: ticket.status, to: dto.status };
    }
    if (dto.priority !== undefined) changes.priority = dto.priority;
    if (dto.assigneeId !== undefined) changes.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) changes.dueDate = dto.dueDate;

    if (dto.title !== undefined) ticket.title = dto.title;
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.status !== undefined) ticket.status = dto.status;
    if (dto.priority !== undefined) {
      ticket.priority = dto.priority;
      // spec §3.7: a manual priority change resets auto-escalation state so the
      // next escalation cycle re-evaluates from the new priority
      ticket.isOverdue = false;
    }
    if (dto.assigneeId !== undefined) ticket.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) {
      ticket.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    try {
      await this.ticketsRepo.save(ticket);
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === 'OptimisticLockVersionMismatchError') {
        throw new ConflictException(
          'Ticket was modified by another request; refresh and retry',
        );
      }
      throw err;
    }

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.TICKET_UPDATED,
      resourceType: AuditResourceType.TICKET,
      resourceId: id,
      metadata: { changes },
    });
  }

  async softDelete(id: number, requesterSub: number): Promise<void> {
    const ticket = await this.findOneRaw(id);
    ticket.deletedAt = new Date();
    await this.ticketsRepo.save(ticket);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.TICKET_DELETED,
      resourceType: AuditResourceType.TICKET,
      resourceId: id,
    });
  }

  async findDeletedByProject(projectId: number): Promise<TicketResponseDto[]> {
    // If the project itself is soft-deleted, return 404. Admin must restore the
    // project before accessing its deleted tickets (natural consequence of D3).
    await this.projectsService.findOne(projectId);

    const tickets = await this.ticketsRepo.find({
      where: { projectId, deletedAt: Not(IsNull()) },
    });
    return tickets.map(TicketResponseDto.from);
  }

  async restore(id: number, requesterSub: number): Promise<void> {
    const ticket = await this.ticketsRepo.findOne({
      where: { id, deletedAt: Not(IsNull()) },
    });
    if (!ticket) throw new NotFoundException(`Ticket #${id} not found`);

    ticket.deletedAt = null;
    await this.ticketsRepo.save(ticket);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: requesterSub,
      action: AuditAction.TICKET_RESTORED,
      resourceType: AuditResourceType.TICKET,
      resourceId: id,
    });
  }

  private async findOneRaw(id: number): Promise<Ticket> {
    const ticket = await this.ticketsRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!ticket) throw new NotFoundException(`Ticket #${id} not found`);
    return ticket;
  }
}
