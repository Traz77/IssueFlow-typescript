import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { parse } from 'csv-parse/sync';
import { TicketsImportExportService } from './tickets-import-export.service';
import { Ticket } from './entities/ticket.entity';
import { TicketsService } from './tickets.service';
import { ProjectsService } from '../projects/projects.service';
import { TicketStatus } from '../common/enums/ticket-status.enum';
import { TicketPriority } from '../common/enums/ticket-priority.enum';
import { TicketType } from '../common/enums/ticket-type.enum';

const mockRepo = () => ({
  find: jest.fn(),
});

const mockProjectsService = () => ({
  findOne: jest.fn(),
});

const mockTicketsService = () => ({
  create: jest.fn(),
});

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    title: 'Fix bug',
    description: 'Some description',
    status: TicketStatus.TODO,
    priority: TicketPriority.HIGH,
    type: TicketType.BUG,
    projectId: 5,
    assigneeId: null,
    dueDate: null,
    isOverdue: false,
    deletedAt: null,
    version: 1,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }) as Ticket;

const csvBuffer = (content: string): Buffer => Buffer.from(content, 'utf-8');

describe('TicketsImportExportService', () => {
  let service: TicketsImportExportService;
  let repo: ReturnType<typeof mockRepo>;
  let projectsService: ReturnType<typeof mockProjectsService>;
  let ticketsService: ReturnType<typeof mockTicketsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsImportExportService,
        { provide: getRepositoryToken(Ticket), useFactory: mockRepo },
        { provide: ProjectsService, useFactory: mockProjectsService },
        { provide: TicketsService, useFactory: mockTicketsService },
      ],
    }).compile();

    service = module.get(TicketsImportExportService);
    repo = module.get(getRepositoryToken(Ticket));
    projectsService = module.get(ProjectsService);
    ticketsService = module.get(TicketsService);
  });

  describe('exportProject()', () => {
    it('throws NotFoundException when project is missing', async () => {
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project #99 not found'));
      await expect(service.exportProject(99)).rejects.toThrow(NotFoundException);
    });

    it('returns RFC 4180-compliant CSV with header row', async () => {
      projectsService.findOne.mockResolvedValue({});
      repo.find.mockResolvedValue([makeTicket()]);

      const csv = await service.exportProject(5);

      expect(csv).toContain('id,title,description,status,priority,type,assigneeId');
      expect(csv).toContain('Fix bug');
    });

    it('wraps description containing a comma in double quotes (RFC 4180)', async () => {
      projectsService.findOne.mockResolvedValue({});
      repo.find.mockResolvedValue([makeTicket({ description: 'Fix bug, urgent' })]);

      const csv = await service.exportProject(5);

      expect(csv).toContain('"Fix bug, urgent"');
    });

    it('doubles embedded double-quotes in description (RFC 4180)', async () => {
      projectsService.findOne.mockResolvedValue({});
      repo.find.mockResolvedValue([makeTicket({ description: 'She said "yes"' })]);

      const csv = await service.exportProject(5);

      expect(csv).toContain('"She said ""yes"""');
    });

    it('round-trips comma-containing description through csv-parse', async () => {
      projectsService.findOne.mockResolvedValue({});
      const original = makeTicket({ description: 'Fix bug, urgent' });
      repo.find.mockResolvedValue([original]);

      const csv = await service.exportProject(5);
      const rows = parse(csv, { columns: true, skip_empty_lines: true });

      expect(rows[0].description).toBe('Fix bug, urgent');
    });

    it('round-trips quote-containing description through csv-parse', async () => {
      projectsService.findOne.mockResolvedValue({});
      const original = makeTicket({ description: 'She said "yes"' });
      repo.find.mockResolvedValue([original]);

      const csv = await service.exportProject(5);
      const rows = parse(csv, { columns: true, skip_empty_lines: true });

      expect(rows[0].description).toBe('She said "yes"');
    });
  });

  describe('importProject()', () => {
    it('throws NotFoundException when project is missing', async () => {
      projectsService.findOne.mockRejectedValue(new NotFoundException('Project #99 not found'));
      const buf = csvBuffer('title,status,priority,type\nValid,TODO,HIGH,BUG\n');
      await expect(service.importProject(99, buf, 1)).rejects.toThrow(NotFoundException);
    });

    it('creates tickets for all valid rows', async () => {
      projectsService.findOne.mockResolvedValue({});
      ticketsService.create.mockResolvedValue({});

      const buf = csvBuffer(
        'title,description,status,priority,type\n' +
          'Ticket A,desc a,TODO,HIGH,BUG\n' +
          'Ticket B,desc b,TODO,MEDIUM,FEATURE\n',
      );

      const result = await service.importProject(5, buf, 1);

      expect(ticketsService.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ created: 2, failed: 0, errors: [] });
    });

    it('calls ticketsService.create with projectId forced from form field, not CSV', async () => {
      projectsService.findOne.mockResolvedValue({});
      ticketsService.create.mockResolvedValue({});

      const buf = csvBuffer(
        'title,description,status,priority,type,projectId\n' +
          'Ticket A,desc,TODO,HIGH,BUG,999\n', // CSV has wrong projectId
      );

      await service.importProject(5, buf, 1);

      expect(ticketsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 5 }),
        1,
      );
    });

    it('reports row 2 as failed when first data row is invalid (missing title)', async () => {
      projectsService.findOne.mockResolvedValue({});

      // header = row 1; first data row = row 2
      const buf = csvBuffer(
        'title,description,status,priority,type\n' +
          ',desc1,TODO,HIGH,BUG\n' +
          'Valid,desc2,TODO,HIGH,BUG\n',
      );

      ticketsService.create.mockResolvedValue({});
      const result = await service.importProject(5, buf, 1);

      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row).toBe(2);
    });

    it('reports row 3 as failed when second data row is invalid', async () => {
      projectsService.findOne.mockResolvedValue({});
      ticketsService.create.mockResolvedValue({});

      const buf = csvBuffer(
        'title,description,status,priority,type\n' +
          'Valid,desc1,TODO,HIGH,BUG\n' + // row 2 — good
          ',desc2,TODO,HIGH,BUG\n', // row 3 — bad (no title)
      );

      const result = await service.importProject(5, buf, 1);

      expect(result.errors[0].row).toBe(3);
    });

    it('counts service-thrown errors (e.g. missing assignee) as failed rows', async () => {
      projectsService.findOne.mockResolvedValue({});
      ticketsService.create.mockRejectedValueOnce(new Error('Assignee user does not exist'));

      const buf = csvBuffer(
        'title,description,status,priority,type,assigneeId\n' +
          'Ticket,desc,TODO,HIGH,BUG,9999\n',
      );

      const result = await service.importProject(5, buf, 1);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain('Assignee');
    });
  });
});
