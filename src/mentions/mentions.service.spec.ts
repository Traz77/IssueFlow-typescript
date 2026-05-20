import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MentionsService } from './mentions.service';
import { Mention } from './entities/mention.entity';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

const makeUser = (id: number, username: string): User =>
  ({ id, username, fullName: `User ${id}` }) as User;

const makeComment = (id: number): Comment =>
  ({
    id,
    ticketId: 10,
    authorId: 1,
    content: 'content',
    version: 1,
    mentions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Comment;

const makeQb = (overrides: Record<string, jest.Mock> = {}) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  setParameter: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  into: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  orIgnore: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({}),
  getMany: jest.fn().mockResolvedValue([]),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  subQuery: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  getQuery: jest.fn().mockReturnValue('(SELECT 1)'),
  ...overrides,
});

describe('MentionsService', () => {
  let service: MentionsService;
  let mentionRepo: { delete: jest.Mock; createQueryBuilder: jest.Mock };
  let commentRepo: { createQueryBuilder: jest.Mock };
  let userRepo: { createQueryBuilder: jest.Mock };
  let usersService: { findOne: jest.Mock };
  let userQb: ReturnType<typeof makeQb>;
  let mentionInsertQb: ReturnType<typeof makeQb>;
  let commentQb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    userQb = makeQb();
    mentionInsertQb = makeQb();
    commentQb = makeQb();

    mentionRepo = {
      delete: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn().mockReturnValue(mentionInsertQb),
    };
    commentRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(commentQb),
    };
    userRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(userQb),
    };
    usersService = { findOne: jest.fn().mockResolvedValue({ id: 1 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionsService,
        { provide: getRepositoryToken(Mention), useValue: mentionRepo },
        { provide: getRepositoryToken(Comment), useValue: commentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<MentionsService>(MentionsService);
  });

  describe('resolveMentionedUsers()', () => {
    it('returns [] for content with no mentions, without querying the DB', async () => {
      const result = await service.resolveMentionedUsers('no mentions here');
      expect(result).toEqual([]);
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns matched users and silently drops unknown usernames', async () => {
      const alice = makeUser(1, 'alice');
      userQb.getMany.mockResolvedValue([alice]);

      const result = await service.resolveMentionedUsers('Hey @alice and @ghost');
      expect(result).toEqual([alice]);
    });

    it('passes lowercased candidates to QueryBuilder where clause', async () => {
      await service.resolveMentionedUsers('@Alice @BOB');
      expect(userQb.where).toHaveBeenCalledWith(
        'LOWER(u.username) IN (:...names)',
        { names: ['alice', 'bob'] },
      );
    });
  });

  describe('persistMentionsForComment()', () => {
    it('calls orIgnore insert when users are resolved', async () => {
      const bob = makeUser(2, 'bob');
      userQb.getMany.mockResolvedValue([bob]);

      await service.persistMentionsForComment(5, 'Hey @bob');

      expect(mentionInsertQb.insert).toHaveBeenCalled();
      expect(mentionInsertQb.orIgnore).toHaveBeenCalled();
      expect(mentionInsertQb.execute).toHaveBeenCalled();
    });

    it('skips insert entirely when content has no mentions', async () => {
      await service.persistMentionsForComment(5, 'no mentions');
      expect(mentionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('syncMentionsForComment()', () => {
    it('deletes existing mentions before inserting new ones', async () => {
      const callOrder: string[] = [];
      mentionRepo.delete = jest.fn().mockImplementation(() => {
        callOrder.push('delete');
        return Promise.resolve({});
      });
      mentionInsertQb.execute = jest.fn().mockImplementation(() => {
        callOrder.push('insert');
        return Promise.resolve({});
      });

      const bob = makeUser(2, 'bob');
      userQb.getMany.mockResolvedValue([bob]);

      await service.syncMentionsForComment(5, '@bob');

      expect(callOrder[0]).toBe('delete');
      expect(callOrder[1]).toBe('insert');
      expect(mentionRepo.delete).toHaveBeenCalledWith({ commentId: 5 });
    });
  });

  describe('findCommentsMentioningUser()', () => {
    it('throws NotFoundException when user does not exist', async () => {
      usersService.findOne.mockRejectedValue(new NotFoundException());
      await expect(
        service.findCommentsMentioningUser(999, 1, 20),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns { data, total, page } with correct pagination math', async () => {
      const comment = makeComment(1);
      commentQb.getManyAndCount.mockResolvedValue([[comment], 1]);

      const result = await service.findCommentsMentioningUser(1, 2, 10);

      expect(result).toEqual({ data: [comment], total: 1, page: 2 });
      expect(commentQb.skip).toHaveBeenCalledWith(10); // (2-1) * 10
      expect(commentQb.take).toHaveBeenCalledWith(10);
    });
  });
});
