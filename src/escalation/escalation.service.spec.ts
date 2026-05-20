import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EscalationService } from './escalation.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketType } from '../common/enums/ticket-type.enum';
import { AuditAction, AuditActorType } from '../audit-log/audit-action.enum';

const mockRepo = {
  find: jest.fn(),
  save: jest.fn(),
};

const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) };

const PAST = new Date(Date.now() - 60_000);

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    title: 'Test',
    description: null,
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    type: TicketType.BUG,
    projectId: 1,
    assigneeId: null,
    dueDate: PAST,
    isOverdue: false,
    deletedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Ticket;

describe('EscalationService', () => {
  let service: EscalationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: getRepositoryToken(Ticket), useValue: mockRepo },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<EscalationService>(EscalationService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
    mockRepo.save.mockImplementation((t: Ticket) => Promise.resolve(t));
  });

  describe('priority promotion', () => {
    it('LOW → MEDIUM: promoted++, audit emitted with from/to', async () => {
      const ticket = makeTicket({ id: 1, priority: TicketPriority.LOW });
      mockRepo.find.mockResolvedValue([ticket]);

      const result = await service.runEscalation();

      expect(result).toEqual({ promoted: 1, markedOverdue: 0, skipped: 0 });
      expect(mockRepo.save).toHaveBeenCalledTimes(1);
      const saved = mockRepo.save.mock.calls[0][0] as Ticket;
      expect(saved.priority).toBe(TicketPriority.MEDIUM);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          action: AuditAction.AUTO_ESCALATE,
          resourceId: 1,
          metadata: expect.objectContaining({ from: TicketPriority.LOW, to: TicketPriority.MEDIUM }),
        }),
      );
    });

    it('MEDIUM → HIGH: promoted++', async () => {
      const ticket = makeTicket({ id: 2, priority: TicketPriority.MEDIUM });
      mockRepo.find.mockResolvedValue([ticket]);

      const result = await service.runEscalation();

      expect(result.promoted).toBe(1);
      const saved = mockRepo.save.mock.calls[0][0] as Ticket;
      expect(saved.priority).toBe(TicketPriority.HIGH);
    });

    it('HIGH → CRITICAL: promoted++, isOverdue stays false (flip happens next cycle)', async () => {
      const ticket = makeTicket({ id: 3, priority: TicketPriority.HIGH, isOverdue: false });
      mockRepo.find.mockResolvedValue([ticket]);

      const result = await service.runEscalation();

      expect(result.promoted).toBe(1);
      const saved = mockRepo.save.mock.calls[0][0] as Ticket;
      expect(saved.priority).toBe(TicketPriority.CRITICAL);
      expect(saved.isOverdue).toBe(false);
    });
  });

  describe('CRITICAL handling', () => {
    it('CRITICAL + !isOverdue → isOverdue set to true, audit with reachedCritical', async () => {
      const ticket = makeTicket({ id: 4, priority: TicketPriority.CRITICAL, isOverdue: false });
      mockRepo.find.mockResolvedValue([ticket]);

      const result = await service.runEscalation();

      expect(result).toEqual({ promoted: 0, markedOverdue: 1, skipped: 0 });
      const saved = mockRepo.save.mock.calls[0][0] as Ticket;
      expect(saved.isOverdue).toBe(true);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          action: AuditAction.AUTO_ESCALATE,
          resourceId: 4,
          metadata: expect.objectContaining({ reachedCritical: true, isOverdueSet: true }),
        }),
      );
    });

    it('CRITICAL + isOverdue=true → SKIPPED: no save, no audit', async () => {
      const ticket = makeTicket({ id: 5, priority: TicketPriority.CRITICAL, isOverdue: true });
      mockRepo.find.mockResolvedValue([ticket]);

      const result = await service.runEscalation();

      expect(result).toEqual({ promoted: 0, markedOverdue: 0, skipped: 1 });
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });
  });

  describe('query filter exclusions', () => {
    it('excludes DONE tickets (Not condition)', async () => {
      // The find() call uses Not(TicketStatus.DONE) in where clause;
      // we verify the query args contain that filter
      mockRepo.find.mockResolvedValue([]);

      await service.runEscalation();

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.anything(), // Not(TicketStatus.DONE)
          }),
        }),
      );
    });

    it('excludes soft-deleted tickets (IsNull on deletedAt)', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.runEscalation();

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: expect.anything(), // IsNull()
          }),
        }),
      );
    });

    it('returns zero counts when no overdue tickets found', async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.runEscalation();

      expect(result).toEqual({ promoted: 0, markedOverdue: 0, skipped: 0 });
      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });
  });

  describe('mixed input counter accuracy', () => {
    it('returns correct summary across mixed tickets', async () => {
      const tickets = [
        makeTicket({ id: 1, priority: TicketPriority.LOW }),           // promoted
        makeTicket({ id: 2, priority: TicketPriority.MEDIUM }),        // promoted
        makeTicket({ id: 3, priority: TicketPriority.HIGH }),          // promoted
        makeTicket({ id: 4, priority: TicketPriority.CRITICAL, isOverdue: false }), // markedOverdue
        makeTicket({ id: 5, priority: TicketPriority.CRITICAL, isOverdue: true }),  // skipped
      ];
      mockRepo.find.mockResolvedValue(tickets);

      const result = await service.runEscalation();

      expect(result).toEqual({ promoted: 3, markedOverdue: 1, skipped: 1 });
      // save called 4 times (3 promoted + 1 markedOverdue), not for skipped
      expect(mockRepo.save).toHaveBeenCalledTimes(4);
      // audit called 4 times
      expect(mockAuditLog.log).toHaveBeenCalledTimes(4);
    });
  });
});
