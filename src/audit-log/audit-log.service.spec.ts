import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction, AuditActorType, AuditResourceType } from './audit-action.enum';

const mockRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
};

const baseParams = {
  actorType: AuditActorType.USER,
  actorId: 1,
  action: AuditAction.TICKET_CREATED,
  resourceType: AuditResourceType.TICKET,
  resourceId: 42,
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useValue: mockRepository },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    jest.clearAllMocks();
  });

  describe('log()', () => {
    it('persists an entry with the given params', async () => {
      const entry = { ...baseParams, metadata: null };
      mockRepository.create.mockReturnValue(entry);
      mockRepository.save.mockResolvedValue({ id: 1, ...entry });

      await service.log(baseParams);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: AuditActorType.USER,
          actorId: 1,
          action: AuditAction.TICKET_CREATED,
          resourceType: AuditResourceType.TICKET,
          resourceId: 42,
        }),
      );
      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('swallows repo errors and does NOT throw — calls console.error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      mockRepository.create.mockReturnValue({});
      mockRepository.save.mockRejectedValue(new Error('DB down'));

      await expect(service.log(baseParams)).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Audit log write failed',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('query()', () => {
    it('applies all provided filter fields to the repository call', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.query({
        action: AuditAction.TICKET_UPDATED,
        resourceId: 7,
        page: 2,
        pageSize: 10,
      });

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: AuditAction.TICKET_UPDATED,
            resourceId: 7,
          }),
          order: { createdAt: 'DESC' },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('uses defaults of page=1 and pageSize=50 when not provided', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.query({});

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('returns data, total, page, and pageSize', async () => {
      const fakeEntry = { id: 1, ...baseParams } as unknown as AuditLog;
      mockRepository.findAndCount.mockResolvedValue([[fakeEntry], 1]);

      const result = await service.query({ page: 1, pageSize: 10 });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });
});
