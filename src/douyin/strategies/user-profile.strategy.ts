import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { BusinessException } from '../../common/errors/business.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { DouyinUserEntity } from '../entities/douyin-user.entity';
import { parseRecentAwemes, parseUserFromRaw } from '../parsers/user.parser';
import type {
  IScrapeStrategy,
  ScrapeContext,
} from '../../xhs/strategies/strategy.interface';

type AnyObj = Record<string, unknown>;

export interface UserProfileInput {
  secUserId: string;
  limit?: number;
}

const USER_PROFILE_API = /\/aweme\/v1\/web\/user\/profile\/(other|self)\//i;
const POST_LIST_API = /\/aweme\/v1\/web\/aweme\/post\//i;
const VERIFY_HOST = /verify\.douyin\.com|captcha-verify/i;

@Injectable()
export class UserProfileStrategy implements IScrapeStrategy<
  UserProfileInput,
  DouyinUserEntity
> {
  readonly name = 'douyin-user-profile';
  private readonly logger = new Logger(UserProfileStrategy.name);

  async run(
    page: Page,
    input: UserProfileInput,
    _ctx: ScrapeContext,
  ): Promise<DouyinUserEntity> {
    const url = `https://www.douyin.com/user/${encodeURIComponent(input.secUserId)}`;
    const limit = input.limit ?? 30;

    let userRaw: AnyObj | null = null;
    const awemePages: AnyObj[] = [];

    const onResponse = (resp: Response): void => {
      const u = resp.url();
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      if (USER_PROFILE_API.test(u)) {
        void resp
          .json()
          .then((json) => {
            if (json && typeof json === 'object') userRaw = json as AnyObj;
          })
          .catch(() => undefined);
      } else if (POST_LIST_API.test(u)) {
        void resp
          .json()
          .then((json) => {
            if (json && typeof json === 'object')
              awemePages.push(json as AnyObj);
          })
          .catch(() => undefined);
      }
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
      await randomSleep(1000, 1800);

      // 滚动加载作品分页直到达到 limit 或停滞
      const collected = new Map<
        string,
        ReturnType<typeof parseRecentAwemes>[number]
      >();
      const drain = (): void => {
        for (const p of awemePages) {
          for (const a of parseRecentAwemes(p)) {
            if (!collected.has(a.awemeId)) collected.set(a.awemeId, a);
          }
        }
      };
      drain();
      let stagnant = 0;
      for (let round = 0; round < 30 && collected.size < limit; round++) {
        const prev = collected.size;
        await scrollPage(page, { steps: 2, stepDelayMs: [800, 1600] });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        drain();
        if (collected.size === prev) {
          stagnant += 1;
          if (stagnant >= 4) break;
        } else {
          stagnant = 0;
        }
      }

      const base = parseUserFromRaw(userRaw, input.secUserId, url) ?? {
        secUserId: input.secUserId,
        url,
        fetchedAt: new Date().toISOString(),
        source: 'douyin' as const,
      };
      base.recentAwemes = Array.from(collected.values()).slice(0, limit);
      this.logger.log(
        `[${input.secUserId}] collected ${base.recentAwemes.length} awemes`,
      );
      return base;
    } finally {
      page.off('response', onResponse);
    }
  }
}
