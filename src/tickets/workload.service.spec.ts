import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkloadService } from './workload.service';
import { Ticket } from './entities/ticket.entity';
import { User } from '../users/entities/user.entity';

const mockTicketRepo = {};
const mockUserRepo = { createQueryBuilder: jest.fn() };

type RawRow = { userId: string; username: string; openTicketCount: string };

const buildQb = (rows: RawRow[]) => {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  mockUserRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
};

describe('WorkloadService', () => {
  let service: WorkloadService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkloadService,
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<WorkloadService>(WorkloadService);
    jest.clearAllMocks();
  });

  describe('getProjectWorkload()', () => {
    it('returns linked DEVELOPERs sorted by openTicketCount ASC, tie-broken by createdAt ASC', async () => {
      buildQb([
        { userId: '3', username: 'devNew', openTicketCount: '0' },
        { userId: '2', username: 'devMid', openTicketCount: '1' },
        { userId: '1', username: 'devOld', openTicketCount: '2' },
      ]);

      const result = await service.getProjectWorkload(1);

      expect(result).toEqual([
        { userId: 3, username: 'devNew', openTicketCount: 0 },
        { userId: 2, username: 'devMid', openTicketCount: 1 },
        { userId: 1, username: 'devOld', openTicketCount: 2 },
      ]);
    });

    it('tie-break: two devs with equal load — older registrant comes first', async () => {
      buildQb([
        { userId: '10', username: 'older', openTicketCount: '2' },
        { userId: '20', username: 'newer', openTicketCount: '2' },
      ]);

      const result = await service.getProjectWorkload(1);

      expect(result[0].userId).toBe(10);
      expect(result[1].userId).toBe(20);
    });

    it('includes a DEVELOPER project owner with zero open tickets (owner-linkage path)', async () => {
      buildQb([{ userId: '5', username: 'devOwner', openTicketCount: '0' }]);

      const result = await service.getProjectWorkload(2);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ userId: 5, username: 'devOwner', openTicketCount: 0 });
    });

    it('includes a DEVELOPER who only has a DONE ticket — linked with openTicketCount=0 (assignment-linkage path)', async () => {
      // DONE ticket establishes linkage but the JOIN ON clause excludes DONE from count
      buildQb([{ userId: '9', username: 'devDone', openTicketCount: '0' }]);

      const result = await service.getProjectWorkload(3);

      expect(result).toHaveLength(1);
      expect(result[0].openTicketCount).toBe(0);
    });

    it('excludes a DEVELOPER who has never owned or been assigned in the project (linkage exclusion)', async () => {
      buildQb([]);

      const result = await service.getProjectWorkload(4);

      expect(result).toHaveLength(0);
    });

    it('excludes ADMIN users — role filter WHERE u.role = DEVELOPER is applied', async () => {
      const qb = buildQb([]);

      await service.getProjectWorkload(5);

      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('u.role'),
        expect.objectContaining({ role: 'DEVELOPER' }),
      );
    });
  });

  describe('pickAutoAssignee()', () => {
    it('returns the first linked developer userId (lowest load)', async () => {
      buildQb([
        { userId: '7', username: 'devA', openTicketCount: '0' },
        { userId: '8', username: 'devB', openTicketCount: '3' },
      ]);

      const result = await service.pickAutoAssignee(1);

      expect(result).toBe(7);
    });

    it('returns null when no linked DEVELOPER exists', async () => {
      buildQb([]);

      const result = await service.pickAutoAssignee(99);

      expect(result).toBeNull();
    });
  });
});
