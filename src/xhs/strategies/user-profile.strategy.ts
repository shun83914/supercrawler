import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { UserEntity } from '../entities/user.entity';
import { parseUserFromState } from '../parsers/user.parser';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

export interface UserProfileInput {
  userId: string;
  noteLimit?: number;
}

@Injectable()
export class UserProfileStrategy implements IScrapeStrategy<UserProfileInput, UserEntity> {
  readonly name = 'user-profile';
  private readonly logger = new Logger(UserProfileStrategy.name);

  async run(page: Page, input: UserProfileInput, _ctx: ScrapeContext): Promise<UserEntity> {
    const url = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(input.userId)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await randomSleep(800, 1600);

    const stateJson = await page.evaluate(() => {
      const w = window as unknown as { __INITIAL_STATE__?: unknown };
      const root = w.__INITIAL_STATE__ ?? null;
      if (root === null) return null;
      const seen = new WeakSet<object>();
      try {
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
    const state: unknown = stateJson ? JSON.parse(stateJson) : null;
    const base = parseUserFromState(state, input.userId, url) ?? {
      userId: input.userId,
      url,
      fetchedAt: new Date().toISOString(),
      source: 'xhs' as const,
    };

    const noteLimit = input.noteLimit ?? 30;
    const notes = await this.collectNotes(page, noteLimit);
    base.notes = notes;
    base.notesCount = base.notesCount ?? notes.length;
    this.logger.log(`[${input.userId}] collected ${notes.length} notes`);
    return base;
  }

  private async collectNotes(
    page: Page,
    limit: number,
  ): Promise<NonNullable<UserEntity['notes']>> {
    const collected = new Map<string, NonNullable<UserEntity['notes']>[number]>();
    let stagnantRounds = 0;
    for (let round = 0; round < 60 && collected.size < limit; round++) {
      const batch = await page.$$eval('section.note-item, a.cover', (nodes) =>
        nodes.slice(0, 400).map((el) => {
          const anchor = (el.tagName === 'A' ? el : el.querySelector('a')) as
            | HTMLAnchorElement
            | null;
          const href = anchor?.getAttribute('href') ?? '';
          const match = href.match(/\/explore\/([\w]+)|\/user\/profile\/[^/]+\/([\w]+)/);
          const noteId = match?.[1] ?? match?.[2] ?? '';
          const img = el.querySelector('img') as HTMLImageElement | null;
          const title =
            (el.querySelector('.title, .footer .title') as HTMLElement | null)?.innerText ??
            undefined;
          const likedText =
            (el.querySelector('.count, .like-wrapper .count') as HTMLElement | null)?.innerText ??
            undefined;
          return { noteId, title, cover: img?.src, likedText };
        }),
      );
      const prev = collected.size;
      for (const b of batch) {
        if (!b.noteId || collected.has(b.noteId)) continue;
        collected.set(b.noteId, {
          noteId: b.noteId,
          title: b.title,
          cover: b.cover,
        });
        if (collected.size >= limit) break;
      }
      if (collected.size === prev) {
        stagnantRounds += 1;
        if (stagnantRounds >= 3) break;
      } else {
        stagnantRounds = 0;
      }
      await scrollPage(page, { steps: 1, stepDelayMs: [700, 1400] });
    }
    return Array.from(collected.values()).slice(0, limit);
  }
}
