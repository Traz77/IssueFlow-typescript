import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommentsService } from './comments.service';
import { Comment } from './entities/comment.entity';
import { TicketsService } from '../tickets/tickets.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MentionsService } from '../mentions/mentions.service';
import { UserRole } from '../common/enums/user-role.enum';

// QB chain used for refetch-by-id in create() and for findAllByTicket()
const mockQbChain = {
  where: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getOne: jest.fn(),
};

const mockRepository = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQbChain),
};

const mockTicketsService = { findOne: jest.fn() };
const mockAuditLog = { log: jest.fn() };
const mockMentionsService = {
  persistMentionsForComment: jest.fn(),
  syncMentionsForComment: jest.fn(),
};

const makeComment = (overrides: Partial<Comment> = {}): Comment =>
  ({
    id: 1,
    ticketId: 10,
    authorId: 42,
    content: 'Original content',
    version: 1,
    mentions: [],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }) as Comment;

describe('CommentsService', () => {
  let service: CommentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comment), useValue: mockRepository },
        { provide: TicketsService, useValue: mockTicketsService },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: MentionsService, useValue: mockMentionsService },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
    mockMentionsService.persistMentionsForComment.mockResolvedValue([]);
    mockMentionsService.syncMentionsForComment.mockResolvedValue([]);
    mockRepository.createQueryBuilder.mockReturnValue(mockQbChain);
    mockQbChain.where.mockReturnThis();
    mockQbChain.leftJoinAndSelect.mockReturnThis();
    mockQbChain.orderBy.mockReturnThis();
    mockQbChain.getOne.mockResolvedValue(makeComment({ version: 1 }));
    mockQbChain.getMany.mockResolvedValue([]);
  });

  describe('create()', () => {
    it('throws NotFoundException when ticket does not exist', async () => {
      mockTicketsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.create(99, 1, { content: 'Hello' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('persists and returns CommentResponseDto with version=1 when ticket exists', async () => {
      mockTicketsService.findOne.mockResolvedValue({ id: 10 });
      const comment = makeComment({ version: 1 });
      mockRepository.create.mockReturnValue(comment);
      mockRepository.save.mockResolvedValue(comment);
      mockQbChain.getOne.mockResolvedValue(comment);

      const result = await service.create(10, 42, { content: 'Hello' });

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        id: 1,
        ticketId: 10,
        authorId: 42,
        content: 'Original content',
        version: 1,
        mentionedUsers: [],
      });
    });

    it('calls audit.log after successful create', async () => {
      mockTicketsService.findOne.mockResolvedValue({ id: 10 });
      const comment = makeComment({ id: 5, authorId: 42 });
      mockRepository.create.mockReturnValue(comment);
      mockRepository.save.mockResolvedValue(comment);
      mockQbChain.getOne.mockResolvedValue(comment);

      await service.create(10, 42, { content: 'Hello' });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 42, resourceId: 5 }),
      );
    });

    it('calls mentionsService.persistMentionsForComment with saved id and content', async () => {
      mockTicketsService.findOne.mockResolvedValue({ id: 10 });
      const comment = makeComment({ id: 7 });
      mockRepository.create.mockReturnValue(comment);
      mockRepository.save.mockResolvedValue(comment);
      mockQbChain.getOne.mockResolvedValue(comment);

      await service.create(10, 42, { content: 'Hey @bob' });

      expect(mockMentionsService.persistMentionsForComment).toHaveBeenCalledWith(7, 'Hey @bob');
    });
  });

  describe('update()', () => {
    it('throws ForbiddenException when caller is not author and not ADMIN', async () => {
      mockRepository.findOneBy.mockResolvedValue(makeComment({ authorId: 42 }));

      await expect(
        service.update(10, 1, { content: 'Hacked', version: 1 }, 99, UserRole.DEVELOPER),
      ).rejects.toThrow(
        new ForbiddenException('You may only modify your own comments'),
      );
    });

    it('succeeds when caller is the author', async () => {
      const comment = makeComment({ authorId: 42, version: 1 });
      mockRepository.findOneBy.mockResolvedValue(comment);
      mockRepository.save.mockResolvedValue({ ...comment, content: 'Updated', version: 2 });

      await expect(
        service.update(10, 1, { content: 'Updated', version: 1 }, 42, UserRole.DEVELOPER),
      ).resolves.toBeUndefined();

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      const saved = mockRepository.save.mock.calls[0][0] as Comment;
      expect(saved.content).toBe('Updated');
    });

    it('succeeds when caller is ADMIN even if not the author', async () => {
      const comment = makeComment({ authorId: 42, version: 1 });
      mockRepository.findOneBy.mockResolvedValue(comment);
      mockRepository.save.mockResolvedValue({ ...comment, content: 'Mod edit', version: 2 });

      await expect(
        service.update(10, 1, { content: 'Mod edit', version: 1 }, 99, UserRole.ADMIN),
      ).resolves.toBeUndefined();

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException on stale version', async () => {
      mockRepository.findOneBy.mockResolvedValue(makeComment({ authorId: 42, version: 3 }));

      await expect(
        service.update(10, 1, { content: 'Stale', version: 1 }, 42, UserRole.DEVELOPER),
      ).rejects.toThrow(
        new ConflictException(
          'Comment was modified by another request; refresh and retry',
        ),
      );
    });

    it('calls mentionsService.syncMentionsForComment with comment id and new content', async () => {
      const comment = makeComment({ authorId: 42, version: 1 });
      mockRepository.findOneBy.mockResolvedValue(comment);
      mockRepository.save.mockResolvedValue({ ...comment, content: 'Updated @bob', version: 2 });

      await service.update(10, 1, { content: 'Updated @bob', version: 1 }, 42, UserRole.DEVELOPER);

      expect(mockMentionsService.syncMentionsForComment).toHaveBeenCalledWith(1, 'Updated @bob');
    });
  });

  describe('remove()', () => {
    it('throws ForbiddenException when caller is not author and not ADMIN', async () => {
      mockRepository.findOneBy.mockResolvedValue(makeComment({ authorId: 42 }));

      await expect(
        service.remove(10, 1, 99, UserRole.DEVELOPER),
      ).rejects.toThrow(
        new ForbiddenException('You may only modify your own comments'),
      );
    });

    it('hard-deletes when caller is the author', async () => {
      const comment = makeComment({ authorId: 42 });
      mockRepository.findOneBy.mockResolvedValue(comment);
      mockRepository.remove.mockResolvedValue(comment);

      await service.remove(10, 1, 42, UserRole.DEVELOPER);

      expect(mockRepository.remove).toHaveBeenCalledWith(comment);
    });
  });
});
