import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { CommentEntity } from '../entities/comment.entity';
import { parseCommentsPayload } from '../parsers/comment.parser';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

export interface CommentsInput {
  noteId: string;
  limit?: number;
}

const COMMENT_API_PATTERN = /\/api\/sns\/web\/v\d+\/comment\/(page|sub\/page)/;

@Injectable()
export class CommentsStrategy implements IScrapeStrategy<CommentsInput, CommentEntity[]> {
  readonly name = 'comments';
  private readonly logger = new Logger(CommentsStrategy.name);

  async run(page: Page, input: CommentsInput, _ctx: ScrapeContext): Promise<CommentEntity[]> {
    const url = `https://www.xiaohongshu.com/explore/${encodeURIComponent(input.noteId)}`;
    const collected = new Map<string, CommentEntity>();
    const limit = input.limit ?? 200;

    const responseHandler = async (resp: Response): Promise<void> => {
      if (!COMMENT_API_PATTERN.test(resp.url())) return;
      try {
        const json = await resp.json();
        const { comments } = parseCommentsPayload(json, input.noteId);
        for (const c of comments) {
          if (!collected.has(c.commentId)) collected.set(c.commentId, c);
        }
      } catch (err) {
        this.logger.warn(`parse comments resp failed: ${(err as Error).message}`);
      }
    };
    page.on('response', responseHandler);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1200, 2000);

      // 评论区滚动触发分页，直到 limit 或 无新增
      let stagnant = 0;
      for (let round = 0; round < 80 && collected.size < limit; round++) {
        const prev = collected.size;
        await scrollPage(page, { steps: 2, stepDelayMs: [900, 1700] });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        if (collected.size === prev) {
          stagnant += 1;
          if (stagnant >= 4) break;
        } else {
          stagnant = 0;
        }
      }
    } finally {
      page.off('response', responseHandler);
    }

    this.logger.log(`[comments:${input.noteId}] collected ${collected.size}`);
    return Array.from(collected.values()).slice(0, limit);
  }
}
