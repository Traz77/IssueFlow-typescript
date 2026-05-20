import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { TicketDependenciesService } from './ticket-dependencies.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { WorkloadService } from './workload.service';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketType } from '../common/enums/ticket-type.enum';
import { AuditAction, AuditActorType } from '../audit-log/audit-action.enum';

const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockProjectsService = { findOne: jest.fn() };
const mockUsersService = { findOne: jest.fn() };
const mockTicketDependencies = { getUnresolvedBlockers: jest.fn() };
const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) };
const mockWorkloadService = { pickAutoAssignee: jest.fn() };

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    title: 'Test ticket',
    description: null,
    status: TicketStatus.TODO,
    priority: TicketPriority.MEDIUM,
    type: TicketType.BUG,
    projectId: 1,
    assigneeId: null,
    dueDate: null,
    isOverdue: false,
    deletedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Ticket;

describe('TicketsService', () => {
  let service: TicketsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: mockRepository },
        { provide: ProjectsService, useValue: mockProjectsService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: TicketDependenciesService, useValue: mockTicketDependencies },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkloadService, useValue: mockWorkloadService },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
    mockTicketDependencies.getUnresolvedBlockers.mockResolvedValue([]);
    mockWorkloadService.pickAutoAssignee.mockResolvedValue(null);
  });

  describe('create()', () => {
    const baseDto = {
      title: 'Test ticket',
      status: TicketStatus.TODO,
      priority: TicketPriority.HIGH,
      type: TicketType.BUG,
      projectId: 1,
    };

    it('throws BadRequestException when project does not exist', async () => {
      mockProjectsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(service.create(baseDto, 1)).rejects.toThrow(
        new BadRequestException('Project does not exist'),
      );
    });

    it('does not throw when assigneeId is not provided', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      const ticket = makeTicket();
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await expect(service.create(baseDto, 1)).resolves.toBeDefined();
      expect(mockUsersService.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when assigneeId is provided but user does not exist', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      mockUsersService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.create({ ...baseDto, assigneeId: 999 }, 1),
      ).rejects.toThrow(new BadRequestException('Assignee user does not exist'));
    });

    it('persists and returns TicketResponseDto with version field', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      const ticket = makeTicket({ version: 1 });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      const result = await service.create(baseDto, 1);

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 1, title: 'Test ticket', projectId: 1, version: 1 });
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('calls audit.log after successful create', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      const ticket = makeTicket({ id: 10, version: 1 });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await service.create(baseDto, 42);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 42, resourceId: 10 }),
      );
    });

    it('auto-assigns when assigneeId is omitted — calls pickAutoAssignee and uses the result', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      mockWorkloadService.pickAutoAssignee.mockResolvedValue(42);
      const ticket = makeTicket({ id: 5, assigneeId: 42 });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      const result = await service.create(baseDto, 1);

      expect(mockWorkloadService.pickAutoAssignee).toHaveBeenCalledWith(baseDto.projectId);
      expect(result.assigneeId).toBe(42);
    });

    it('does NOT call pickAutoAssignee when assigneeId is explicitly provided', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      mockUsersService.findOne.mockResolvedValue({ id: 7 });
      const ticket = makeTicket({ id: 5, assigneeId: 7 });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await service.create({ ...baseDto, assigneeId: 7 }, 1);

      expect(mockWorkloadService.pickAutoAssignee).toHaveBeenCalledTimes(0);
    });

    it('does NOT call pickAutoAssignee when assigneeId is explicit null (intentional unassign)', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      const ticket = makeTicket({ id: 5, assigneeId: null });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await service.create({ ...baseDto, assigneeId: null as unknown as number }, 1);

      expect(mockWorkloadService.pickAutoAssignee).toHaveBeenCalledTimes(0);
    });

    it('emits AUTO_ASSIGN audit entry with actorType=SYSTEM when auto-assignment picks a user', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      mockWorkloadService.pickAutoAssignee.mockResolvedValue(55);
      const ticket = makeTicket({ id: 3, assigneeId: 55 });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await service.create(baseDto, 1);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: AuditActorType.SYSTEM,
          actorId: null,
          action: AuditAction.AUTO_ASSIGN,
          resourceId: 3,
          metadata: expect.objectContaining({ assignedUserId: 55 }),
        }),
      );
    });

    it('does NOT emit AUTO_ASSIGN audit when pickAutoAssignee returns null; TICKET_CREATED still fires', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      mockWorkloadService.pickAutoAssignee.mockResolvedValue(null);
      const ticket = makeTicket({ id: 3, assigneeId: null });
      mockRepository.create.mockReturnValue(ticket);
      mockRepository.save.mockResolvedValue(ticket);

      await service.create(baseDto, 1);

      expect(mockAuditLog.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AUTO_ASSIGN }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.TICKET_CREATED }),
      );
    });
  });

  describe('update()', () => {
    it('throws ConflictException when ticket status is DONE', async () => {
      const ticket = makeTicket({ status: TicketStatus.DONE, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);

      await expect(
        service.update(1, { version: 1 }, 1),
      ).rejects.toThrow(
        new ConflictException('Ticket is DONE and cannot be modified'),
      );
    });

    it('throws ConflictException when version does not match', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, version: 2 });
      mockRepository.findOne.mockResolvedValue(ticket);

      await expect(
        service.update(1, { version: 1 }, 1),
      ).rejects.toThrow(
        new ConflictException(
          'Ticket was modified by another request; refresh and retry',
        ),
      );
    });

    it('throws BadRequestException on invalid status transition', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);

      await expect(
        service.update(1, { status: TicketStatus.DONE, version: 1 }, 1),
      ).rejects.toThrow(BadRequestException);
    });

    it('succeeds on valid forward transition', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({
        ...ticket,
        status: TicketStatus.IN_PROGRESS,
        version: 2,
      });

      await expect(
        service.update(1, { status: TicketStatus.IN_PROGRESS, version: 1 }, 1),
      ).resolves.toBeUndefined();

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it('throws ConflictException when transitioning to DONE with unresolved blockers', async () => {
      const ticket = makeTicket({ status: TicketStatus.IN_REVIEW, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockTicketDependencies.getUnresolvedBlockers.mockResolvedValue([3, 5]);

      await expect(
        service.update(1, { status: TicketStatus.DONE, version: 1 }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('succeeds transitioning to DONE when all blockers are resolved', async () => {
      const ticket = makeTicket({ status: TicketStatus.IN_REVIEW, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockTicketDependencies.getUnresolvedBlockers.mockResolvedValue([]);
      mockRepository.save.mockResolvedValue({ ...ticket, status: TicketStatus.DONE, version: 2 });

      await expect(
        service.update(1, { status: TicketStatus.DONE, version: 1 }, 1),
      ).resolves.toBeUndefined();

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('does not check blockers when transitioning to a non-DONE status', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, status: TicketStatus.IN_PROGRESS, version: 2 });

      await service.update(1, { status: TicketStatus.IN_PROGRESS, version: 1 }, 1);

      expect(mockTicketDependencies.getUnresolvedBlockers).not.toHaveBeenCalled();
    });

    it('resets isOverdue to false when dto.priority is provided (spec §3.7)', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, priority: TicketPriority.MEDIUM, isOverdue: true, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, priority: TicketPriority.LOW, isOverdue: false, version: 2 });

      await service.update(1, { priority: TicketPriority.LOW, version: 1 }, 1);

      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.priority).toBe(TicketPriority.LOW);
      expect(saved.isOverdue).toBe(false);
    });

    it('does NOT reset isOverdue when only dueDate is provided', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, isOverdue: true, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      const future = new Date(Date.now() + 86400_000).toISOString();
      mockRepository.save.mockResolvedValue({ ...ticket, dueDate: new Date(future), version: 2 });

      await service.update(1, { dueDate: future, version: 1 }, 1);

      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.dueDate).toBeInstanceOf(Date);
      expect(saved.isOverdue).toBe(true);
    });

    it('does not change isOverdue when neither priority nor dueDate is provided', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, isOverdue: true, version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, title: 'Updated', version: 2 });

      await service.update(1, { title: 'Updated', version: 1 }, 1);

      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.isOverdue).toBe(true);
    });

    it('clears dueDate when dto.dueDate is null', async () => {
      const ticket = makeTicket({ status: TicketStatus.TODO, dueDate: new Date(), version: 1 });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, dueDate: null, version: 2 });

      await service.update(1, { dueDate: null, version: 1 }, 1);

      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.dueDate).toBeNull();
    });
  });

  describe('softDelete()', () => {
    it('sets deletedAt and saves even when status is DONE', async () => {
      const ticket = makeTicket({ status: TicketStatus.DONE, deletedAt: null });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, deletedAt: new Date() });

      await service.softDelete(1, 1);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, deletedAt: IsNull() },
      });
      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when ticket is already deleted', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.softDelete(1, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findDeletedByProject()', () => {
    it('returns soft-deleted tickets for a valid project', async () => {
      mockProjectsService.findOne.mockResolvedValue({ id: 1 });
      const deleted = makeTicket({ id: 5, deletedAt: new Date() });
      mockRepository.find.mockResolvedValue([deleted]);

      const result = await service.findDeletedByProject(1);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { projectId: 1, deletedAt: Not(IsNull()) },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(5);
    });

    it('throws NotFoundException when the parent project is soft-deleted', async () => {
      mockProjectsService.findOne.mockRejectedValue(new NotFoundException('Project #1 not found'));

      await expect(service.findDeletedByProject(1)).rejects.toThrow(NotFoundException);
      expect(mockRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('restore()', () => {
    it('throws NotFoundException when ticket is not in a deleted state', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.restore(99, 1)).rejects.toThrow(NotFoundException);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 99, deletedAt: Not(IsNull()) },
      });
    });

    it('clears deletedAt, saves, and calls audit log', async () => {
      const ticket = makeTicket({ id: 3, deletedAt: new Date() });
      mockRepository.findOne.mockResolvedValue(ticket);
      mockRepository.save.mockResolvedValue({ ...ticket, deletedAt: null });

      await service.restore(3, 42);

      const saved = mockRepository.save.mock.calls[0][0] as Ticket;
      expect(saved.deletedAt).toBeNull();
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 42, resourceId: 3 }),
      );
    });
  });
});
