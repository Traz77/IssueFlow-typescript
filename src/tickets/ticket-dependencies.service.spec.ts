import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TicketDependenciesService } from './ticket-dependencies.service';
import { TicketDependency } from './entities/ticket-dependency.entity';
import { Ticket } from './entities/ticket.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketType } from '../common/enums/ticket-type.enum';

const mockDepRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockTicketRepo = {
  findOne: jest.fn(),
};

const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) };

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
    dueDate: null,
    isOverdue: false,
    deletedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Ticket;

describe('TicketDependenciesService', () => {
  let service: TicketDependenciesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketDependenciesService,
        { provide: getRepositoryToken(TicketDependency), useValue: mockDepRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<TicketDependenciesService>(TicketDependenciesService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
  });

  describe('addDependency()', () => {
    it('throws NotFoundException when the ticket does not exist', async () => {
      mockTicketRepo.findOne.mockResolvedValue(null);

      await expect(service.addDependency(99, 1, 1)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the blocker does not exist', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket({ id: 1 }))
        .mockResolvedValueOnce(null);

      await expect(service.addDependency(1, 99, 1)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException on self-loop', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket({ id: 1 }))
        .mockResolvedValueOnce(makeTicket({ id: 1 }));

      await expect(service.addDependency(1, 1, 1)).rejects.toThrow(
        new BadRequestException('A ticket cannot block itself'),
      );
    });

    it('throws BadRequestException on direct cycle', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket({ id: 1 }))
        .mockResolvedValueOnce(makeTicket({ id: 2 }));
      mockDepRepo.findOneBy
        .mockResolvedValueOnce({ ticketId: 2, blockerId: 1 }); // reverse exists

      await expect(service.addDependency(1, 2, 1)).rejects.toThrow(
        new BadRequestException('Adding this dependency would create a direct cycle'),
      );
    });

    it('throws BadRequestException when dependency already exists', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket({ id: 1 }))
        .mockResolvedValueOnce(makeTicket({ id: 2 }));
      mockDepRepo.findOneBy
        .mockResolvedValueOnce(null)          // no reverse cycle
        .mockResolvedValueOnce({ ticketId: 1, blockerId: 2 }); // already exists

      await expect(service.addDependency(1, 2, 1)).rejects.toThrow(
        new BadRequestException('Dependency already exists'),
      );
    });

    it('persists the dependency and calls audit.log on success', async () => {
      mockTicketRepo.findOne
        .mockResolvedValueOnce(makeTicket({ id: 1 }))
        .mockResolvedValueOnce(makeTicket({ id: 2 }));
      mockDepRepo.findOneBy.mockResolvedValue(null);
      const dep = { ticketId: 1, blockerId: 2 };
      mockDepRepo.create.mockReturnValue(dep);
      mockDepRepo.save.mockResolvedValue(dep);

      await service.addDependency(1, 2, 7);

      expect(mockDepRepo.save).toHaveBeenCalledTimes(1);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 7, resourceId: 1, metadata: { blockerId: 2 } }),
      );
    });
  });

  describe('removeDependency()', () => {
    it('throws NotFoundException when dependency does not exist', async () => {
      mockDepRepo.findOneBy.mockResolvedValue(null);

      await expect(service.removeDependency(1, 2, 1)).rejects.toThrow(NotFoundException);
    });

    it('removes the dependency and calls audit.log on success', async () => {
      const dep = { ticketId: 1, blockerId: 2 };
      mockDepRepo.findOneBy.mockResolvedValue(dep);
      mockDepRepo.remove.mockResolvedValue(dep);

      await service.removeDependency(1, 2, 7);

      expect(mockDepRepo.remove).toHaveBeenCalledWith(dep);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 7, resourceId: 1, metadata: { blockerId: 2 } }),
      );
    });
  });
});
