import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DouyinController } from './douyin.controller';
import { DouyinService } from './douyin.service';
import { AwemeDetailStrategy } from './strategies/aweme-detail.strategy';
import { CommentsStrategy } from './strategies/comments.strategy';
import { SearchStrategy } from './strategies/search.strategy';
import { UserProfileStrategy } from './strategies/user-profile.strategy';

@Module({
  imports: [AuthModule],
  controllers: [DouyinController],
  providers: [
    DouyinService,
    AwemeDetailStrategy,
    UserProfileStrategy,
    SearchStrategy,
    CommentsStrategy,
  ],
  exports: [DouyinService],
})
export class DouyinModule {}
