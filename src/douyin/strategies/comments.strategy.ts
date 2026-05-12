import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { BusinessException } from '../../common/errors/business.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { DouyinCommentEntity } from '../entities/douyin-comment.entity';
import { parseCommentsPayload } from '../parsers/comment.parser';
import type {
  IScrapeStrategy,
  ScrapeContext,
} from '../../xhs/strategies/strategy.interface';

export interface CommentsInput {
  awemeId: string;
  limit?: number;
}

const COMMENT_API = /\/aweme\/v1\/web\/comment\/list\/(reply\/)?/i;
const VERIFY_HOST = /verify\.douyin\.com|captcha-verify/i;

@Injectable()
export class CommentsStrategy implements IScrapeStrategy<
  CommentsInput,
  DouyinCommentEntity[]
> {
  readonly name = 'douyin-comments';
  private readonly logger = new Logger(CommentsStrategy.name);

  async run(
    page: Page,
    input: CommentsInput,
    _ctx: ScrapeContext,
  ): Promise<DouyinCommentEntity[]> {
    const url = `https://www.douyin.com/video/${encodeURIComponent(input.awemeId)}`;
    const limit = input.limit ?? 200;
    const collected = new Map<string, DouyinCommentEntity>();

    const onResponse = (resp: Response): void => {
      if (!COMMENT_API.test(resp.url())) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => {
          const { comments } = parseCommentsPayload(json, input.awemeId);
          for (const c of comments) {
            if (!collected.has(c.cid)) collected.set(c.cid, c);
          }
        })
        .catch((err) => {
          this.logger.warn(
            `parse comments resp failed: ${(err as Error).message}`,
          );
        });
    };
    page.on('response', onResponse);

    try {
      const resp = await page
        .goto(url, { waitUntil: 'domcontentloaded' })
        .catch(() => null);
      if (resp && VERIFY_HOST.test(resp.url())) {
        throw new BusinessException(
          ErrorCode.DOUYIN_CAPTCHA,
          `redirected to verify: ${resp.url()}`,
        );
      }
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1500, 2400);

      // 抖音评论区在视频右侧，需要先点开评论按钮（兼容多种 UI 版本）
      try {
        const btn = await page.$(
          'xpath=//*[contains(@class, "comment-icon") or @data-e2e="video-side-bar-comment"]',
        );
        if (btn) await btn.click({ timeout: 3000 }).catch(() => undefined);
        await randomSleep(800, 1400);
      } catch {
        // ignore — 部分版本 UI 默认展开
      }

      let stagnant = 0;
      for (let round = 0; round < 80 && collected.size < limit; round++) {
        const prev = collected.size;
        await scrollPage(page, { steps: 2, stepDelayMs: [900, 1700] });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        if (collected.size === prev) {
          stagnant += 1;
          if (stagnant >= 5) break;
        } else {
          stagnant = 0;
        }
      }
    } finally {
      page.off('response', onResponse);
    }

    this.logger.log(`[comments:${input.awemeId}] collected ${collected.size}`);
    return Array.from(collected.values()).slice(0, limit);
  }
}
