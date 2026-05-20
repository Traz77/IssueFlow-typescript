import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mention } from './entities/mention.entity';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { extractMentionedUsernames } from './mention-parser';

@Injectable()
export class MentionsService {
  constructor(
    @InjectRepository(Mention)
    private readonly mentionRepo: Repository<Mention>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly usersService: UsersService,
  ) {}

  async resolveMentionedUsers(content: string): Promise<User[]> {
    const usernames = extractMentionedUsernames(content);
    if (usernames.length === 0) return [];
    return this.userRepo
      .createQueryBuilder('u')
      .where('LOWER(u.username) IN (:...names)', { names: usernames })
      .getMany();
  }

  async persistMentionsForComment(commentId: number, content: string): Promise<User[]> {
    const users = await this.resolveMentionedUsers(content);
    if (users.length > 0) {
      await this.mentionRepo
        .createQueryBuilder()
        .insert()
        .into(Mention)
        .values(users.map((u) => ({ commentId, userId: u.id })))
        .orIgnore()
        .execute();
    }
    return users;
  }

  async syncMentionsForComment(commentId: number, content: string): Promise<User[]> {
    await this.mentionRepo.delete({ commentId });
    return this.persistMentionsForComment(commentId, content);
  }

  async findCommentsMentioningUser(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ data: Comment[]; total: number; page: number }> {
    await this.usersService.findOne(userId);

    const [data, total] = await this.commentRepo
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.mentions', 'mention')
      .leftJoinAndSelect('mention.user', 'mentionedUser')
      .where((qb) => {
        const sub = qb
          .subQuery()
          .select('m.commentId')
          .from(Mention, 'm')
          .where('m.userId = :userId')
          .getQuery();
        return `comment.id IN ${sub}`;
      })
      .setParameter('userId', userId)
      .orderBy('comment.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data, total, page };
  }
}
