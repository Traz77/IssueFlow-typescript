import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as fsPromises from 'fs/promises';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';
import { TicketsService } from '../tickets/tickets.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
  remove: jest.fn(),
});

const mockTicketsService = () => ({
  findOne: jest.fn(),
});

const mockAuditLog = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    originalname: 'test.png',
    filename: 'uuid-disk-name',
    mimetype: 'image/png',
    size: 1024,
    ...overrides,
  }) as Express.Multer.File;

const makeAttachment = (overrides: Partial<Attachment> = {}): Attachment =>
  ({
    id: 1,
    ticketId: 10,
    filename: 'test.png',
    storedName: 'uuid-disk-name',
    contentType: 'image/png',
    size: 1024,
    uploadedById: 99,
    createdAt: new Date('2025-01-01'),
    ...overrides,
  }) as Attachment;

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let repo: ReturnType<typeof mockRepo>;
  let ticketsService: ReturnType<typeof mockTicketsService>;
  let auditLog: ReturnType<typeof mockAuditLog>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: getRepositoryToken(Attachment), useFactory: mockRepo },
        { provide: TicketsService, useFactory: mockTicketsService },
        { provide: AuditLogService, useFactory: mockAuditLog },
      ],
    }).compile();

    service = module.get(AttachmentsService);
    repo = module.get(getRepositoryToken(Attachment));
    ticketsService = module.get(TicketsService);
    auditLog = module.get(AuditLogService);
  });

  describe('create()', () => {
    it('propagates NotFoundException when ticket is missing', async () => {
      ticketsService.findOne.mockRejectedValue(new NotFoundException('Ticket #10 not found'));
      await expect(service.create(10, makeFile(), 99)).rejects.toThrow(NotFoundException);
    });

    it('persists with sanitized filename and calls audit log', async () => {
      const att = makeAttachment();
      ticketsService.findOne.mockResolvedValue({});
      repo.create.mockReturnValue(att);
      repo.save.mockResolvedValue(att);

      const result = await service.create(10, makeFile({ originalname: 'test.png' }), 99);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'test.png', storedName: 'uuid-disk-name' }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ATTACHMENT_ADDED }),
      );
      expect(result).toEqual({ id: 1, ticketId: 10, filename: 'test.png', contentType: 'image/png' });
    });

    it('sanitizes control characters from originalname', async () => {
      const att = makeAttachment({ filename: 'badfile.png' });
      ticketsService.findOne.mockResolvedValue({});
      repo.create.mockReturnValue(att);
      repo.save.mockResolvedValue(att);

      await service.create(10, makeFile({ originalname: 'bad\x00file.png' }), 99);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'badfile.png' }),
      );
    });
  });

  describe('listByTicket()', () => {
    it('returns mapped AttachmentResponseDtos ordered by createdAt DESC', async () => {
      const att = makeAttachment();
      ticketsService.findOne.mockResolvedValue({});
      repo.find.mockResolvedValue([att]);

      const result = await service.listByTicket(10);

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ticketId: 10 }, order: { createdAt: 'DESC' } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        ticketId: 10,
        filename: 'test.png',
        size: 1024,
        uploadedById: 99,
      });
    });
  });

  describe('remove()', () => {
    it('throws NotFoundException when attachment does not exist', async () => {
      ticketsService.findOne.mockResolvedValue({});
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.remove(10, 999, 99)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when attachmentId belongs to a different ticket (ID-confusion guard)', async () => {
      ticketsService.findOne.mockResolvedValue({});
      repo.findOneBy.mockResolvedValue(makeAttachment({ ticketId: 20 })); // belongs to ticket 20, not 10

      await expect(service.remove(10, 1, 99)).rejects.toThrow(NotFoundException);
    });

    it('proceeds and deletes DB row even when fs.unlink rejects', async () => {
      ticketsService.findOne.mockResolvedValue({});
      const att = makeAttachment();
      repo.findOneBy.mockResolvedValue(att);
      repo.remove.mockResolvedValue(undefined);
      (fsPromises.unlink as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

      await expect(service.remove(10, 1, 99)).resolves.toBeUndefined();
      expect(repo.remove).toHaveBeenCalledWith(att);
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ATTACHMENT_REMOVED }),
      );
    });

    it('deletes disk file and DB row on success', async () => {
      ticketsService.findOne.mockResolvedValue({});
      const att = makeAttachment();
      repo.findOneBy.mockResolvedValue(att);
      repo.remove.mockResolvedValue(undefined);
      (fsPromises.unlink as jest.Mock).mockResolvedValueOnce(undefined);

      await service.remove(10, 1, 99);

      expect(fsPromises.unlink).toHaveBeenCalledWith(expect.stringContaining('uuid-disk-name'));
      expect(repo.remove).toHaveBeenCalledWith(att);
    });
  });
});
