import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { MentionsService } from './mentions.service';
import { MentionsQueryDto } from './dto/mentions-query.dto';
import { CommentResponseDto } from '../comments/dto/comment-response.dto';

@Controller('users/:userId/mentions')
export class UserMentionsController {
  constructor(private readonly mentionsService: MentionsService) {}

  @Get()
  async findMentions(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: MentionsQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { data, total } = await this.mentionsService.findCommentsMentioningUser(
      userId,
      page,
      pageSize,
    );
    return {
      data: data.map(CommentResponseDto.from),
      total,
      page,
    };
  }
}
