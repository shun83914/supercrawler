import type {
  AwemeAuthor,
  AwemeEntity,
  AwemeMusic,
  AwemeStats,
  AwemeVideo,
} from '../entities/aweme.entity';

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

/** 抖音时间字段一般是秒级 unix 时间戳。 */
function unixToIso(ts: unknown): string | undefined {
  const n = asNumber(ts);
  if (n === undefined) return undefined;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 抖音 video.play_addr.url_list 取首个可用 URL。 */
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
    return (
      asString(o.url) ??
      pickUrl(o.url_list) ??
      pickUrl(o.uri_list) ??
      pickUrl(o.urlList)
    );
  }
  return undefined;
}

function pickAuthor(raw: AnyObj | undefined): AwemeAuthor | undefined {
  if (!raw) return undefined;
  const a = raw;
  const avatar =
    pickUrl(a.avatar_thumb) ??
    pickUrl(a.avatar_medium) ??
    pickUrl(a.avatar_larger) ??
    pickUrl(a.avatar);
  return {
    secUserId:
      asString(a.sec_uid) ?? asString(a.secUserId) ?? asString(a.sec_id),
    uid: asString(a.uid),
    uniqueId: asString(a.unique_id) ?? asString(a.short_id),
    nickname: asString(a.nickname),
    avatar,
    signature: asString(a.signature),
  };
}

function pickStats(raw: AnyObj | undefined): AwemeStats | undefined {
  const s = (raw?.statistics ?? raw?.stats ?? {}) as AnyObj;
  if (!s || Object.keys(s).length === 0) return undefined;
  return {
    diggCount: asNumber(s.digg_count) ?? asNumber(s.diggCount),
    commentCount: asNumber(s.comment_count) ?? asNumber(s.commentCount),
    shareCount: asNumber(s.share_count) ?? asNumber(s.shareCount),
    collectCount: asNumber(s.collect_count) ?? asNumber(s.collectCount),
    playCount: asNumber(s.play_count) ?? asNumber(s.playCount),
  };
}

function pickVideo(raw: AnyObj | undefined): AwemeVideo | undefined {
  const v = (raw?.video ?? {}) as AnyObj;
  if (!v || Object.keys(v).length === 0) return undefined;
  const cover =
    pickUrl(v.cover) ?? pickUrl(v.origin_cover) ?? pickUrl(v.dynamic_cover);
  const playAddr =
    pickUrl(v.play_addr) ??
    pickUrl(v.play_addr_h264) ??
    pickUrl(v.download_addr);
  const duration =
    asNumber(v.duration) ?? asNumber((v.video_model as AnyObj)?.duration);
  return {
    coverUrl: cover,
    playAddr,
    duration:
      duration !== undefined && duration > 1000
        ? Math.round(duration / 1000)
        : duration,
    width: asNumber(v.width),
    height: asNumber(v.height),
    ratio: asString(v.ratio),
  };
}

function pickMusic(raw: AnyObj | undefined): AwemeMusic | undefined {
  const m = (raw?.music ?? {}) as AnyObj;
  if (!m || Object.keys(m).length === 0) return undefined;
  return {
    id: asString(m.id) ?? asString(m.mid),
    title: asString(m.title),
    author: asString(m.author),
    playUrl: pickUrl(m.play_url) ?? pickUrl(m.playUrl),
    duration: asNumber(m.duration),
  };
}

function pickTags(raw: AnyObj): string[] | undefined {
  const arr = (raw.text_extra ?? raw.textExtra ?? []) as AnyObj[];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const tags: string[] = [];
  for (const it of arr) {
    const name = asString(it.hashtag_name) ?? asString(it.hashtagName);
    if (name) tags.push(name);
  }
  return tags.length ? tags : undefined;
}

/**
 * 把抖音 aweme_detail / aweme_info / item 等结构归一化成 AwemeEntity。
 * 对应接口：/aweme/v1/web/aweme/detail/、/aweme/v1/web/general/search/single/、/aweme/v1/web/aweme/post/
 */
export function parseAwemeFromRaw(
  raw: unknown,
  awemeId: string,
  url: string,
): AwemeEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as AnyObj;
  const desc = asString(r.desc) ?? asString(r.title);
  const author = pickAuthor(r.author as AnyObj | undefined);
  const stats = pickStats(r);
  if (!desc && !stats && !author) return null;

  return {
    awemeId,
    url,
    title: desc?.slice(0, 80),
    desc,
    type:
      asNumber(r.aweme_type) === 0
        ? 'video'
        : asNumber(r.aweme_type) !== undefined
          ? `aweme_type:${String(r.aweme_type)}`
          : asString(r.aweme_type),
    createTime: unixToIso(r.create_time) ?? unixToIso(r.createTime),
    author,
    stats,
    video: pickVideo(r),
    music: pickMusic(r),
    tags: pickTags(r),
    ipLocation: asString(r.ip_label) ?? asString(r.region),
    fetchedAt: new Date().toISOString(),
    source: 'douyin',
    raw: r,
  };
}

/**
 * 在 payload 树中按 aweme_id 寻找匹配的 aweme_detail 对象。
 * 抖音返回结构常见形式：
 *   { aweme_detail: { ... } }
 *   { aweme_list: [ ... ] }
 *   { data: [ { aweme_info: {...} } ] } —— 搜索接口
 */
export function findAwemeInPayload(
  payload: unknown,
  awemeId?: string,
  depth = 0,
): AnyObj | null {
  if (!payload || depth > 8) return null;
  if (Array.isArray(payload)) {
    for (const v of payload) {
      const f = findAwemeInPayload(v, awemeId, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  const obj = payload as AnyObj;
  const idMatch =
    asString(obj.aweme_id) === awemeId ||
    asString(obj.awemeId) === awemeId ||
    (awemeId === undefined &&
      (obj.aweme_id !== undefined || obj.awemeId !== undefined));
  if (
    idMatch &&
    (obj.desc !== undefined ||
      obj.statistics !== undefined ||
      obj.video !== undefined)
  ) {
    return obj;
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') {
      const found = findAwemeInPayload(v, awemeId, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
