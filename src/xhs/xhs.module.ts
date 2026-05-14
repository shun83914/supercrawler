import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommentsStrategy } from './strategies/comments.strategy';
import { NoteDetailStrategy } from './strategies/note-detail.strategy';
import { SearchStrategy } from './strategies/search.strategy';
import { UserProfileStrategy } from './strategies/user-profile.strategy';
import { XhsController } from './xhs.controller';
import { XhsService } from './xhs.service';

@Module({
  imports: [AuthModule],
  controllers: [XhsController],
  providers: [
    XhsService,
    NoteDetailStrategy,
    UserProfileStrategy,
    SearchStrategy,
    CommentsStrategy,
  ],
  exports: [XhsService],
})
export class XhsModule {}
