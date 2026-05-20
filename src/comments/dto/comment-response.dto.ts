import { Comment } from '../entities/comment.entity';
import { MentionedUserDto } from '../../mentions/dto/mentioned-user.dto';

export class CommentResponseDto {
  id: number;
  ticketId: number;
  authorId: number;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  mentionedUsers: MentionedUserDto[];

  static from(comment: Comment): CommentResponseDto {
    const dto = new CommentResponseDto();
    dto.id = comment.id;
    dto.ticketId = comment.ticketId;
    dto.authorId = comment.authorId;
    dto.content = comment.content;
    dto.version = comment.version;
    dto.createdAt = comment.createdAt.toISOString();
    dto.updatedAt = comment.updatedAt.toISOString();
    dto.mentionedUsers = comment.mentions
      ? comment.mentions.map((m) => MentionedUserDto.from(m.user))
      : [];
    return dto;
  }
}
