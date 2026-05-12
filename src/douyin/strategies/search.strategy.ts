import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { BusinessException } from '../../common/errors/business.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import { parseAwemeFromRaw } from '../parsers/aweme.parser';
import type { AwemeEntity } from '../entities/aweme.entity';
import type {
  IScrapeStrategy,
  ScrapeContext,
} from '../../xhs/strategies/strategy.interface';

type AnyObj = Record<string, unknown>;

export const DOUYIN_SEARCH_SORTS = ['general', 'latest', 'popular'] as const;
export type DouyinSearchSort = (typeof DOUYIN_SEARCH_SORTS)[number];

export interface SearchInput {
  keyword: string;
  sort?: DouyinSearchSort;
  limit?: number;
}

export interface DouyinSearchItem {
  awemeId: string;
  url: string;
  desc?: string;
  cover?: string;
  diggCount?: number;
  playCount?: number;
  duration?: number;
  createTime?: string;
  author?: { secUserId?: string; nickname?: string };
  keyword: string;
  rank: number;
  fetchedAt: string;
  source: 'douyin';
}

const SEARCH_API =
  /\/aweme\/v1\/web\/general\/search\/single\/|\/aweme\/v1\/web\/search\/item\/|\/aweme\/v1\/web\/discover\/search\//i;
const VERIFY_HOST = /verify\.douyin\.com|captcha-verify/i;

// 1: 综合 / 0: 综合 / 2: 最新 / 4: 点赞最多（不同入口编号略有差异，沿用 web 端常见取值）
const SORT_TYPE_MAP: Record<DouyinSearchSort, string> = {
  general: '_0',
  latest: '_2',
  popular: '_4',
};

@Injectable()
export class SearchStrategy implements IScrapeStrategy<
  SearchInput,
  DouyinSearchItem[]
> {
  readonly name = 'douyin-search';
  private readonly logger = new Logger(SearchStrategy.name);

  async run(
    page: Page,
    input: SearchInput,
    _ctx: ScrapeContext,
  ): Promise<DouyinSearchItem[]> {
    const limit = input.limit ?? 20;
    const sortQuery = SORT_TYPE_MAP[input.sort ?? 'general'];
    const url = `https://www.douyin.com/search/${encodeURIComponent(input.keyword)}?type=video&publish_time=0&sort_type=${sortQuery.replace('_', '')}`;

    const items: DouyinSearchItem[] = [];
    const seen = new Set<string>();
    const fetchedAt = new Date().toISOString();

    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!SEARCH_API.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => {
          if (!json || typeof json !== 'object') return;
          const root = json as AnyObj;
          const data = (root.data ?? root.aweme_list ?? []) as AnyObj[];
          if (!Array.isArray(data)) return;
          for (const entry of data) {
            const aweme =
              ((entry.aweme_info ?? entry.awemeInfo ?? entry) as AnyObj) ??
              null;
            if (!aweme || typeof aweme !== 'object') continue;
            const awemeId =
              (aweme.aweme_id as string | undefined) ??
              (aweme.awemeId as string | undefined);
            if (!awemeId || seen.has(awemeId)) continue;
            seen.add(awemeId);
            const parsed = parseAwemeFromRaw(
              aweme,
              awemeId,
              `https://www.douyin.com/video/${awemeId}`,
            );
            items.push(
              toSearchItem(
                parsed,
                aweme,
                input.keyword,
                items.length + 1,
                fetchedAt,
              ),
            );
          }
        })
        .catch(() => undefined);
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

      let stagnant = 0;
      for (let round = 0; round < 30 && items.length < limit; round++) {
        const prev = items.length;
        await scrollPage(page, { steps: 2, stepDelayMs: [900, 1700] });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        if (items.length === prev) {
          stagnant += 1;
          if (stagnant >= 4) break;
        } else {
          stagnant = 0;
        }
      }
    } finally {
      page.off('response', onResponse);
    }

    this.logger.log(`[search:${input.keyword}] collected ${items.length}`);
    return items.slice(0, limit);
  }
}

function toSearchItem(
  parsed: AwemeEntity | null,
  raw: AnyObj,
  keyword: string,
  rank: number,
  fetchedAt: string,
): DouyinSearchItem {
  const stats = (raw.statistics as AnyObj | undefined) ?? {};
  const video = (raw.video as AnyObj | undefined) ?? {};
  const cover =
    parsed?.video?.coverUrl ??
    pickFirstUrl(video.cover) ??
    pickFirstUrl(video.origin_cover);
  const author = (raw.author as AnyObj | undefined) ?? {};
  return {
    awemeId: parsed?.awemeId ?? (raw.aweme_id as string),
    url: `https://www.douyin.com/video/${parsed?.awemeId ?? (raw.aweme_id as string)}`,
    desc: parsed?.desc ?? (raw.desc as string | undefined),
    cover,
    diggCount: parsed?.stats?.diggCount ?? toNumber(stats.digg_count),
    playCount: parsed?.stats?.playCount ?? toNumber(stats.play_count),
    duration: parsed?.video?.duration,
    createTime: parsed?.createTime,
    author: {
      secUserId:
        parsed?.author?.secUserId ?? (author.sec_uid as string | undefined),
      nickname:
        parsed?.author?.nickname ?? (author.nickname as string | undefined),
    },
    keyword,
    rank,
    fetchedAt,
    source: 'douyin',
  };
}

function pickFirstUrl(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  const o = v as AnyObj;
  const list = (o.url_list ?? o.urlList) as unknown[] | undefined;
  if (Array.isArray(list)) {
    for (const it of list) if (typeof it === 'string') return it;
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
