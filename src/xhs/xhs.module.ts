import { Module } from '@nestjs/common';
import { CommentsStrategy } from './strategies/comments.strategy';
import { NoteDetailStrategy } from './strategies/note-detail.strategy';
import { SearchStrategy } from './strategies/search.strategy';
import { UserProfileStrategy } from './strategies/user-profile.strategy';
import { XhsController } from './xhs.controller';
import { XhsService } from './xhs.service';

@Module({
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
