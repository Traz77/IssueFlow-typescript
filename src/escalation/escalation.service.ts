import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';

const PRIORITY_LADDER: Record<TicketPriority, TicketPriority | null> = {
  [TicketPriority.LOW]: TicketPriority.MEDIUM,
  [TicketPriority.MEDIUM]: TicketPriority.HIGH,
  [TicketPriority.HIGH]: TicketPriority.CRITICAL,
  [TicketPriority.CRITICAL]: null,
};

export interface EscalationSummary {
  promoted: number;
  markedOverdue: number;
  skipped: number;
}

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly auditLog: AuditLogService,
  ) {}

  async runEscalation(): Promise<EscalationSummary> {
    const overdueTickets = await this.ticketRepo.find({
      where: {
        dueDate: LessThan(new Date()),
        deletedAt: IsNull(),
        status: Not(TicketStatus.DONE),
      },
    });

    let promoted = 0;
    let markedOverdue = 0;
    let skipped = 0;

    for (const ticket of overdueTickets) {
      if (ticket.priority === TicketPriority.CRITICAL) {
        if (!ticket.isOverdue) {
          ticket.isOverdue = true;
          await this.ticketRepo.save(ticket);
          await this.auditLog.log({
            actorType: AuditActorType.SYSTEM,
            actorId: null,
            action: AuditAction.AUTO_ESCALATE,
            resourceType: AuditResourceType.TICKET,
            resourceId: ticket.id,
            metadata: {
              reachedCritical: true,
              isOverdueSet: true,
              dueDate: ticket.dueDate!.toISOString(),
            },
          });
          markedOverdue++;
        } else {
          // Already CRITICAL + isOverdue — idempotent, no state change, no audit
          skipped++;
        }
      } else {
        const nextPriority = PRIORITY_LADDER[ticket.priority];
        if (nextPriority === null) continue;
        const oldPriority = ticket.priority;
        ticket.priority = nextPriority;
        await this.ticketRepo.save(ticket);
        await this.auditLog.log({
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          action: AuditAction.AUTO_ESCALATE,
          resourceType: AuditResourceType.TICKET,
          resourceId: ticket.id,
          metadata: {
            from: oldPriority,
            to: nextPriority,
            dueDate: ticket.dueDate!.toISOString(),
          },
        });
        promoted++;
      }
    }

    return { promoted, markedOverdue, skipped };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.runEscalation();
  }
}
