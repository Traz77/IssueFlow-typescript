import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { TicketsService } from '../tickets/tickets.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit-log/audit-action.enum';
import { MentionsService } from '../mentions/mentions.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentsRepo: Repository<Comment>,
    private readonly ticketsService: TicketsService,
    private readonly auditLog: AuditLogService,
    private readonly mentionsService: MentionsService,
  ) {}

  async findAllByTicket(ticketId: number): Promise<CommentResponseDto[]> {
    await this.ticketsService.findOne(ticketId);
    const comments = await this.commentsRepo
      .createQueryBuilder('comment')
      .where('comment.ticketId = :ticketId', { ticketId })
      .leftJoinAndSelect('comment.mentions', 'mention')
      .leftJoinAndSelect('mention.user', 'mentionedUser')
      .orderBy('comment.createdAt', 'ASC')
      .getMany();
    return comments.map(CommentResponseDto.from);
  }

  async create(
    ticketId: number,
    authorId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    await this.ticketsService.findOne(ticketId);
    const comment = this.commentsRepo.create({
      ticketId,
      authorId,
      content: dto.content,
    });
    const saved = await this.commentsRepo.save(comment);

    await this.mentionsService.persistMentionsForComment(saved.id, dto.content);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: authorId,
      action: AuditAction.COMMENT_CREATED,
      resourceType: AuditResourceType.COMMENT,
      resourceId: saved.id,
      metadata: { ticketId, contentLength: dto.content.length },
    });

    const refetched = await this.commentsRepo
      .createQueryBuilder('comment')
      .where('comment.id = :id', { id: saved.id })
      .leftJoinAndSelect('comment.mentions', 'mention')
      .leftJoinAndSelect('mention.user', 'mentionedUser')
      .getOne();

    return CommentResponseDto.from(refetched!);
  }

  async update(
    ticketId: number,
    id: number,
    dto: UpdateCommentDto,
    currentUserId: number,
    currentUserRole: UserRole,
  ): Promise<void> {
    const comment = await this.findOneRaw(id);

    if (comment.ticketId !== ticketId) {
      throw new NotFoundException(`Comment #${id} not found on ticket #${ticketId}`);
    }

    this.assertCanModify(comment, currentUserId, currentUserRole);

    if (dto.version !== comment.version) {
      throw new ConflictException(
        'Comment was modified by another request; refresh and retry',
      );
    }

    comment.content = dto.content;

    try {
      await this.commentsRepo.save(comment);
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === 'OptimisticLockVersionMismatchError') {
        throw new ConflictException(
          'Comment was modified by another request; refresh and retry',
        );
      }
      throw err;
    }

    await this.mentionsService.syncMentionsForComment(id, dto.content);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: currentUserId,
      action: AuditAction.COMMENT_UPDATED,
      resourceType: AuditResourceType.COMMENT,
      resourceId: id,
      metadata: { ticketId: comment.ticketId },
    });
  }

  async remove(
    ticketId: number,
    id: number,
    currentUserId: number,
    currentUserRole: UserRole,
  ): Promise<void> {
    const comment = await this.findOneRaw(id);

    if (comment.ticketId !== ticketId) {
      throw new NotFoundException(`Comment #${id} not found on ticket #${ticketId}`);
    }

    this.assertCanModify(comment, currentUserId, currentUserRole);

    const { authorId: formerAuthorId } = comment;
    await this.commentsRepo.remove(comment);

    await this.auditLog.log({
      actorType: AuditActorType.USER,
      actorId: currentUserId,
      action: AuditAction.COMMENT_DELETED,
      resourceType: AuditResourceType.COMMENT,
      resourceId: id,
      metadata: { ticketId, formerAuthorId },
    });
  }

  private async findOneRaw(id: number): Promise<Comment> {
    const comment = await this.commentsRepo.findOneBy({ id });
    if (!comment) throw new NotFoundException(`Comment #${id} not found`);
    return comment;
  }

  private assertCanModify(
    comment: Comment,
    currentUserId: number,
    currentUserRole: UserRole,
  ): void {
    if (comment.authorId !== currentUserId && currentUserRole !== UserRole.ADMIN) {
      throw new ForbiddenException('You may only modify your own comments');
    }
  }
}
