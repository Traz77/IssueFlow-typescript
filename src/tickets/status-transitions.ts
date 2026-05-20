import { TicketStatus } from '../common/enums/ticket-status.enum';

export const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.TODO]: [TicketStatus.IN_PROGRESS],
  [TicketStatus.IN_PROGRESS]: [TicketStatus.IN_REVIEW],
  [TicketStatus.IN_REVIEW]: [TicketStatus.DONE],
  [TicketStatus.DONE]: [],
};

export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
