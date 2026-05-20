import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mention } from './entities/mention.entity';
import { Comment } from '../comments/entities/comment.entity';
import { User } from '../users/entities/user.entity';
import { MentionsService } from './mentions.service';
import { UserMentionsController } from './user-mentions.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([Mention, Comment, User]), UsersModule],
  providers: [MentionsService],
  controllers: [UserMentionsController],
  exports: [MentionsService],
})
export class MentionsModule {}
