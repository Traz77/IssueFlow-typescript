import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../../common/enums/ticket-status.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import { TicketType } from '../../common/enums/ticket-type.enum';

export class TicketResponseDto {
  id: number;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  projectId: number;
  assigneeId: number | null;
  dueDate: string | null;
  isOverdue: boolean;
  version: number;

  static from(ticket: Ticket): TicketResponseDto {
    const dto = new TicketResponseDto();
    dto.id = ticket.id;
    dto.title = ticket.title;
    dto.description = ticket.description;
    dto.status = ticket.status;
    dto.priority = ticket.priority;
    dto.type = ticket.type;
    dto.projectId = ticket.projectId;
    dto.assigneeId = ticket.assigneeId;
    dto.dueDate = ticket.dueDate ? ticket.dueDate.toISOString() : null;
    dto.isOverdue = ticket.isOverdue;
    dto.version = ticket.version;
    return dto;
  }
}
