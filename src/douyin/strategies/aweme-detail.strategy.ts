import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { BusinessException } from '../../common/errors/business.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { randomSleep } from '../../common/utils/humanize.util';
import type { AwemeEntity } from '../entities/aweme.entity';
import { findAwemeInPayload, parseAwemeFromRaw } from '../parsers/aweme.parser';
import type {
  IScrapeStrategy,
  ScrapeContext,
} from '../../xhs/strategies/strategy.interface';

type AnyObj = Record<string, unknown>;

export interface AwemeDetailInput {
  awemeId: string;
}

const AWEME_DETAIL_API =
  /\/aweme\/v1\/web\/aweme\/detail\/|\/aweme\/v1\/web\/aweme\/post\/|\/aweme\/v1\/web\/general\/search\/single\//i;

const VERIFY_HOST = /verify\.douyin\.com|captcha-verify/i;

@Injectable()
export class AwemeDetailStrategy implements IScrapeStrategy<
  AwemeDetailInput,
  AwemeEntity
> {
  readonly name = 'douyin-aweme-detail';
  private readonly logger = new Logger(AwemeDetailStrategy.name);

  async run(
    page: Page,
    input: AwemeDetailInput,
    _ctx: ScrapeContext,
  ): Promise<AwemeEntity> {
    const url = `https://www.douyin.com/video/${encodeURIComponent(input.awemeId)}`;
    const fallbackUrl = `https://www.iesdouyin.com/share/video/${encodeURIComponent(input.awemeId)}/`;

    const rawById = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!AWEME_DETAIL_API.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => {
          const found = findAwemeInPayload(json, input.awemeId);
          if (found) rawById.set(input.awemeId, found);
          // 若按 ID 找不到，但 payload 顶层是 aweme_detail 字段，也存一份
          if (!found && json && typeof json === 'object') {
            const detail = (json as AnyObj).aweme_detail as AnyObj | undefined;
            if (detail && typeof detail === 'object')
              rawById.set(input.awemeId, detail);
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
      await randomSleep(800, 1600);

      // 1) XHR 监听结果
      let raw = rawById.get(input.awemeId);

      // 2) 若 XHR 落空，尝试从 window._SSR_DATA / __pace_f 抓
      if (!raw) {
        const ssrJson = await page.evaluate(() => {
          const w = window as unknown as {
            _SSR_DATA?: unknown;
            _ROUTER_DATA?: unknown;
          };
          const root = w._SSR_DATA ?? w._ROUTER_DATA ?? null;
          if (!root) return null;
          try {
            const seen = new WeakSet<object>();
            return JSON.stringify(root, (_k, v) => {
              if (typeof v === 'object' && v !== null) {
                if (seen.has(v as object)) return undefined;
                seen.add(v as object);
              }
              if (typeof v === 'function') return undefined;
              return v;
            });
          } catch {
            return null;
          }
        });
        const state: unknown = ssrJson ? JSON.parse(ssrJson) : null;
        const found = findAwemeInPayload(state, input.awemeId);
        if (found) raw = found;
      }

      // 3) 主域失败，回退分享页（限制更严但反爬更宽松）
      if (!raw) {
        this.logger.warn(
          `[${input.awemeId}] douyin.com 抓取空，尝试 iesdouyin 分享页回退`,
        );
        await page
          .goto(fallbackUrl, { waitUntil: 'domcontentloaded' })
          .catch(() => undefined);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await randomSleep(800, 1500);
        raw = rawById.get(input.awemeId);
      }

      if (!raw) {
        throw new BusinessException(
          ErrorCode.DOUYIN_TARGET_NOT_FOUND,
          `aweme detail not captured for ${input.awemeId}`,
        );
      }

      const parsed = parseAwemeFromRaw(raw, input.awemeId, url);
      if (!parsed) {
        throw new BusinessException(
          ErrorCode.DOUYIN_PARSE_FAILED,
          `failed to parse aweme ${input.awemeId}`,
        );
      }
      return parsed;
    } finally {
      page.off('response', onResponse);
    }
  }
}
