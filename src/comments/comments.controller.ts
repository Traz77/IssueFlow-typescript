import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload.interface';

@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('tickets/:ticketId/comments')
  @HttpCode(200)
  create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CommentResponseDto> {
    return this.commentsService.create(ticketId, user.sub, dto);
  }

  @Get('tickets/:ticketId/comments')
  findAllByTicket(
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<CommentResponseDto[]> {
    return this.commentsService.findAllByTicket(ticketId);
  }

  @Patch('tickets/:ticketId/comments/:commentId')
  @HttpCode(200)
  update(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.commentsService.update(ticketId, commentId, dto, user.sub, user.role);
  }

  @Delete('tickets/:ticketId/comments/:commentId')
  @HttpCode(200)
  remove(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.commentsService.remove(ticketId, commentId, user.sub, user.role);
  }
}
