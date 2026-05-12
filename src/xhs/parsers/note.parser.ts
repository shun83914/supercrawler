import type { NoteEntity, NoteImage } from '../entities/note.entity';

type AnyObj = Record<string, unknown>;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v == null ? undefined : String(v);
const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // 小红书计数字段偶有 "1.2万" 之类，此处保留字符串降级
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

/**
 * 从 window.__INITIAL_STATE__ 解析单条笔记详情。
 * 小红书前端 state 结构常变，此函数容错多条路径。
 */
export function parseNoteFromState(state: unknown, noteId: string, url: string): NoteEntity | null {
  if (!state || typeof state !== 'object') return null;
  const root = state as AnyObj;

  const note = findNoteObject(root, noteId);
  if (!note) return null;

  const interact = (note.interactInfo ?? note.interact_info ?? {}) as AnyObj;
  const user = (note.user ?? note.userInfo ?? {}) as AnyObj;

  const images: NoteImage[] = Array.isArray(note.imageList)
    ? (note.imageList as AnyObj[]).map((img) => ({
        url:
          asString(img.urlDefault) ??
          asString(img.url) ??
          asString((img.infoList as AnyObj[])?.[0]?.url) ??
          '',
        width: asNumber(img.width),
        height: asNumber(img.height),
      }))
    : [];

  const video = note.video
    ? {
        url:
          asString(((note.video as AnyObj).media as AnyObj)?.stream) ??
          asString((note.video as AnyObj).url) ??
          '',
        duration: asNumber(((note.video as AnyObj).capa as AnyObj)?.duration),
      }
    : undefined;

  const tags = Array.isArray(note.tagList)
    ? (note.tagList as AnyObj[]).map((t) => asString(t.name) ?? '').filter(Boolean)
    : undefined;

  return {
    noteId,
    url,
    type: asString(note.type),
    title: asString(note.title),
    content: asString(note.desc) ?? asString(note.content),
    tags,
    images: images.length ? images : undefined,
    video: video && video.url ? video : undefined,
    likedCount: asNumber(interact.likedCount) ?? asNumber(interact.liked_count),
    collectedCount: asNumber(interact.collectedCount) ?? asNumber(interact.collected_count),
    commentCount: asNumber(interact.commentCount) ?? asNumber(interact.comment_count),
    shareCount: asNumber(interact.shareCount) ?? asNumber(interact.share_count),
    author: {
      userId: asString(user.userId) ?? asString(user.user_id),
      nickname: asString(user.nickname),
      avatar: asString(user.avatar),
    },
    publishedAt: asString(note.time) ?? asString(note.lastUpdateTime),
    ipLocation: asString(note.ipLocation) ?? asString(note.ip_location),
    fetchedAt: new Date().toISOString(),
    source: 'xhs',
    raw: note,
  };
}

/**
 * 深度搜索 state 中 id 匹配的笔记对象；小红书不同页面把笔记挂在不同路径下。
 */
function findNoteObject(root: AnyObj, noteId: string, depth = 0): AnyObj | null {
  if (depth > 6) return null;
  if (
    typeof root === 'object' &&
    root !== null &&
    (asString(root.noteId) === noteId || asString(root.id) === noteId) &&
    (root.title !== undefined || root.desc !== undefined || root.imageList !== undefined)
  ) {
    return root;
  }
  for (const key of Object.keys(root)) {
    const val = root[key];
    if (val && typeof val === 'object') {
      const found = findNoteObject(val as AnyObj, noteId, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
