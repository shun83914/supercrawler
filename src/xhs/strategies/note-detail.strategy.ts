import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep } from '../../common/utils/humanize.util';
import type { NoteEntity } from '../entities/note.entity';
import { parseNoteFromState } from '../parsers/note.parser';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface NoteDetailInput {
  noteId: string;
}

const NOTE_API_PATTERN =
  /(api\/sns\/(web|h5)\/v\d+\/(feed|note(_info)?)|note_card|noteDetail)/i;

@Injectable()
export class NoteDetailStrategy implements IScrapeStrategy<NoteDetailInput, NoteEntity> {
  readonly name = 'note-detail';
  private readonly logger = new Logger(NoteDetailStrategy.name);

  async run(page: Page, input: NoteDetailInput, _ctx: ScrapeContext): Promise<NoteEntity> {
    const url = `https://www.xiaohongshu.com/explore/${encodeURIComponent(input.noteId)}`;

    // 策略三道防线：XHR 拦截 > __INITIAL_STATE__ > DOM。
    const xhrRawByNoteId = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      if (!NOTE_API_PATTERN.test(u)) return;
      void resp
        .json()
        .then((json) => {
          indexNotePayload(json, xhrRawByNoteId);
          // h5/v1/note_info 带明确 id 参数，补一下
          if (xhrRawByNoteId.size === 0 && json && typeof json === 'object') {
            const data = (json as AnyObj).data;
            if (data && typeof data === 'object') {
              const d = data as AnyObj;
              const idGuess = asString(d.note_id) ?? asString(d.id) ?? input.noteId;
              if (idGuess && (d.title || d.desc || d.interact_info)) xhrRawByNoteId.set(idGuess, d);
            }
          }
        })
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(800, 1600);

      // 1) XHR 拦截路径。
      const raw = xhrRawByNoteId.get(input.noteId);
      if (raw) {
        const fromXhr = noteEntityFromRaw(raw, input.noteId, url);
        if (fromXhr) return fromXhr;
      }

      // 2) __INITIAL_STATE__ 路径。
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
      const parsed = parseNoteFromState(state, input.noteId, url);
      if (parsed) return parsed;

      // 3) DOM 降级。state.global.firstVisitUrl 的 _rawValue 包含 /404/sec_xxx 则是被风控
      const blocked = isBlockedByRiskRedirect(state);
      this.logger.warn(
        `[${input.noteId}] state 不可用 (stateJsonLen=${stateJson?.length ?? 0}, xhrHits=${xhrRawByNoteId.size}, blocked=${blocked}), fallback DOM`,
      );
      const dom = await page.evaluate(() => {
        const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() || undefined;
        return {
          title: q('#detail-title') ?? q('.note-content .title'),
          content: q('#detail-desc') ?? q('.note-content .desc'),
          author: q('.author-wrapper .username'),
        };
      });
      return {
        noteId: input.noteId,
        url,
        title: dom.title,
        content: dom.content,
        author: dom.author ? { nickname: dom.author } : undefined,
        fetchedAt: new Date().toISOString(),
        source: 'xhs',
      };
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

/** 判断 state 是否被小红书风控重定向到 /404/sec_xxx 安全验证页 */
function isBlockedByRiskRedirect(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false;
  const root = state as AnyObj;
  const g = root.global as AnyObj | undefined;
  if (!g) return false;
  const fv = g.firstVisitUrl as AnyObj | undefined;
  const raw = (fv?._rawValue ?? fv?._value ?? '') as unknown;
  return typeof raw === 'string' && /\/404\/sec_/.test(raw);
}

function indexNotePayload(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 7) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexNotePayload(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;
  const id =
    typeof obj.id === 'string' && /^[0-9a-fA-F]{16,}$/.test(obj.id) ? obj.id : undefined;
  const noteCard =
    (obj.note_card as AnyObj | undefined) ??
    (obj.noteCard as AnyObj | undefined) ??
    (obj.note as AnyObj | undefined);
  if (id && noteCard && typeof noteCard === 'object') {
    sink.set(id, noteCard);
  } else if (id && (obj.title !== undefined || obj.desc !== undefined || obj.interact_info)) {
    sink.set(id, obj);
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexNotePayload(v, sink, depth + 1);
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : v == null ? undefined : String(v);
}

function noteEntityFromRaw(raw: AnyObj, noteId: string, url: string): NoteEntity | null {
  const interact = (raw.interact_info ?? raw.interactInfo ?? {}) as AnyObj;
  const user = (raw.user ?? raw.userInfo ?? {}) as AnyObj;
  const title = asString(raw.title) ?? asString(raw.display_title) ?? asString(raw.desc);
  const desc = asString(raw.desc) ?? asString(raw.content);
  if (!title && !desc && !interact.liked_count && !interact.likedCount) return null;

  const timeRaw =
    raw.time ?? raw.publish_time ?? raw.publishTime ?? raw.last_update_time ?? raw.lastUpdateTime;
  let publishedAt: string | undefined;
  const ts = toNumber(timeRaw);
  if (ts !== undefined) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    publishedAt = new Date(ms).toISOString();
  } else if (typeof timeRaw === 'string') {
    const d = new Date(timeRaw);
    if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
  }

  return {
    noteId,
    url,
    type: asString(raw.type),
    title,
    content: desc,
    likedCount: toNumber(interact.liked_count) ?? toNumber(interact.likedCount),
    collectedCount: toNumber(interact.collected_count) ?? toNumber(interact.collectedCount),
    commentCount: toNumber(interact.comment_count) ?? toNumber(interact.commentCount),
    shareCount: toNumber(interact.share_count) ?? toNumber(interact.shareCount),
    author: {
      userId: asString(user.user_id) ?? asString(user.userId),
      nickname: asString(user.nickname),
      avatar: asString(user.avatar),
    },
    publishedAt,
    ipLocation: asString(raw.ip_location) ?? asString(raw.ipLocation),
    fetchedAt: new Date().toISOString(),
    source: 'xhs',
    raw,
  };
}
