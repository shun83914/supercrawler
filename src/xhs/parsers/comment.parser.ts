import type { CommentEntity } from '../entities/comment.entity';

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

/**
 * 解析小红书评论接口返回 payload：
 * {
 *   data: { comments: [...], has_more, cursor }
 * }
 */
export function parseCommentsPayload(payload: unknown, noteId: string): {
  comments: CommentEntity[];
  hasMore: boolean;
  cursor?: string;
} {
  const resp = (payload as AnyObj) ?? {};
  const data = ((resp.data ?? resp) as AnyObj) ?? {};
  const arr = (data.comments ?? data.list ?? []) as AnyObj[];
  const hasMore = Boolean(data.has_more ?? data.hasMore);
  const cursor = asString(data.cursor);
  const fetchedAt = new Date().toISOString();

  const comments: CommentEntity[] = [];
  for (const c of arr) {
    const main = mapComment(c, noteId, undefined, fetchedAt);
    if (main) comments.push(main);
    const subs = (c.sub_comments ?? c.subComments ?? []) as AnyObj[];
    for (const sc of subs) {
      const s = mapComment(sc, noteId, main?.commentId, fetchedAt);
      if (s) comments.push(s);
    }
  }
  return { comments, hasMore, cursor };
}

function mapComment(
  c: AnyObj,
  noteId: string,
  parentId: string | undefined,
  fetchedAt: string,
): CommentEntity | null {
  const commentId = asString(c.id) ?? asString(c.commentId);
  if (!commentId) return null;
  const user = (c.user_info ?? c.user ?? {}) as AnyObj;
  return {
    commentId,
    noteId,
    parentId,
    content: asString(c.content) ?? '',
    likedCount: asNumber(c.like_count) ?? asNumber(c.likedCount),
    subCount: asNumber(c.sub_comment_count) ?? asNumber(c.subCommentCount),
    ipLocation: asString(c.ip_location) ?? asString(c.ipLocation),
    createdAt: asString(c.create_time) ?? asString(c.createTime),
    user: {
      userId: asString(user.user_id) ?? asString(user.userId),
      nickname: asString(user.nickname),
      avatar: asString(user.image) ?? asString(user.avatar),
    },
    fetchedAt,
    source: 'xhs',
    raw: c,
  };
}
