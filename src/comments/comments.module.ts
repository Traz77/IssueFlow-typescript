import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './entities/comment.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  imports: [TypeOrmModule.forFeature([Comment]), TicketsModule, AuditLogModule, MentionsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
