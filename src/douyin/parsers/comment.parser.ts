import type { DouyinCommentEntity } from '../entities/douyin-comment.entity';

type AnyObj = Record<string, unknown>;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v == null ? undefined : String(v);

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

function pickUrl(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s && /^https?:\/\//.test(s)) return s;
    }
    return undefined;
  }
  if (typeof v === 'object') {
    const o = v as AnyObj;
    return asString(o.url) ?? pickUrl(o.url_list);
  }
  return undefined;
}

function unixToIso(ts: unknown): string | undefined {
  const n = asNumber(ts);
  if (n === undefined) return undefined;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * 解析抖音评论接口 payload：
 *   /aweme/v1/web/comment/list/    一级评论
 *   /aweme/v1/web/comment/list/reply/  二级评论
 * 返回结构：{ comments: [...], cursor, has_more }
 */
export function parseCommentsPayload(
  payload: unknown,
  awemeId: string,
): {
  comments: DouyinCommentEntity[];
  hasMore: boolean;
  cursor?: number;
} {
  if (!payload || typeof payload !== 'object') {
    return { comments: [], hasMore: false };
  }
  const root = payload as AnyObj;
  const arr = (root.comments ?? root.comment_list ?? []) as AnyObj[];
  const hasMore = Boolean(root.has_more ?? root.hasMore);
  const cursor = asNumber(root.cursor);
  const fetchedAt = new Date().toISOString();

  const comments: DouyinCommentEntity[] = [];
  for (const c of arr) {
    const main = mapComment(c, awemeId, undefined, fetchedAt);
    if (main) comments.push(main);
    const subs = (c.reply_comment ?? c.replyComment ?? []) as AnyObj[];
    if (Array.isArray(subs)) {
      for (const sc of subs) {
        const s = mapComment(sc, awemeId, main?.cid, fetchedAt);
        if (s) comments.push(s);
      }
    }
  }
  return { comments, hasMore, cursor };
}

function mapComment(
  c: AnyObj,
  awemeId: string,
  parentCid: string | undefined,
  fetchedAt: string,
): DouyinCommentEntity | null {
  const cid = asString(c.cid) ?? asString(c.id);
  if (!cid) return null;
  const u = (c.user ?? {}) as AnyObj;
  return {
    cid,
    awemeId,
    parentCid,
    text: asString(c.text) ?? '',
    diggCount: asNumber(c.digg_count) ?? asNumber(c.diggCount),
    replyCount: asNumber(c.reply_comment_total) ?? asNumber(c.replyCount),
    createTime: unixToIso(c.create_time),
    ipLocation: asString(c.ip_label),
    user: {
      secUserId: asString(u.sec_uid) ?? asString(u.secUserId),
      uid: asString(u.uid),
      nickname: asString(u.nickname),
      avatar:
        pickUrl(u.avatar_thumb) ??
        pickUrl(u.avatar_medium) ??
        pickUrl(u.avatar),
    },
    fetchedAt,
    source: 'douyin',
    raw: c,
  };
}
