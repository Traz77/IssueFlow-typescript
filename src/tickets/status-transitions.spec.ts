import { TicketStatus } from '../common/enums/ticket-status.enum';
import { isValidTransition } from './status-transitions';

describe('isValidTransition()', () => {
  describe('valid forward transitions (adjacent only)', () => {
    it('allows TODO → IN_PROGRESS', () => {
      expect(isValidTransition(TicketStatus.TODO, TicketStatus.IN_PROGRESS)).toBe(true);
    });

    it('allows IN_PROGRESS → IN_REVIEW', () => {
      expect(isValidTransition(TicketStatus.IN_PROGRESS, TicketStatus.IN_REVIEW)).toBe(true);
    });

    it('allows IN_REVIEW → DONE', () => {
      expect(isValidTransition(TicketStatus.IN_REVIEW, TicketStatus.DONE)).toBe(true);
    });
  });

  describe('same-status transitions (no-op)', () => {
    it('allows TODO → TODO', () => {
      expect(isValidTransition(TicketStatus.TODO, TicketStatus.TODO)).toBe(true);
    });

    it('allows IN_PROGRESS → IN_PROGRESS', () => {
      expect(isValidTransition(TicketStatus.IN_PROGRESS, TicketStatus.IN_PROGRESS)).toBe(true);
    });

    it('allows IN_REVIEW → IN_REVIEW', () => {
      expect(isValidTransition(TicketStatus.IN_REVIEW, TicketStatus.IN_REVIEW)).toBe(true);
    });

    it('allows DONE → DONE', () => {
      expect(isValidTransition(TicketStatus.DONE, TicketStatus.DONE)).toBe(true);
    });
  });

  describe('backward transitions (all rejected)', () => {
    it('rejects IN_PROGRESS → TODO', () => {
      expect(isValidTransition(TicketStatus.IN_PROGRESS, TicketStatus.TODO)).toBe(false);
    });

    it('rejects IN_REVIEW → TODO', () => {
      expect(isValidTransition(TicketStatus.IN_REVIEW, TicketStatus.TODO)).toBe(false);
    });

    it('rejects IN_REVIEW → IN_PROGRESS', () => {
      expect(isValidTransition(TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS)).toBe(false);
    });

    it('rejects DONE → TODO', () => {
      expect(isValidTransition(TicketStatus.DONE, TicketStatus.TODO)).toBe(false);
    });

    it('rejects DONE → IN_PROGRESS', () => {
      expect(isValidTransition(TicketStatus.DONE, TicketStatus.IN_PROGRESS)).toBe(false);
    });

    it('rejects DONE → IN_REVIEW', () => {
      expect(isValidTransition(TicketStatus.DONE, TicketStatus.IN_REVIEW)).toBe(false);
    });
  });

  describe('skip-forward transitions (all rejected per D5)', () => {
    it('rejects TODO → IN_REVIEW', () => {
      expect(isValidTransition(TicketStatus.TODO, TicketStatus.IN_REVIEW)).toBe(false);
    });

    it('rejects TODO → DONE', () => {
      expect(isValidTransition(TicketStatus.TODO, TicketStatus.DONE)).toBe(false);
    });

    it('rejects IN_PROGRESS → DONE', () => {
      expect(isValidTransition(TicketStatus.IN_PROGRESS, TicketStatus.DONE)).toBe(false);
    });
  });
});
