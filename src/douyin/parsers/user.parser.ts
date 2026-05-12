import type {
  DouyinRecentAweme,
  DouyinUserEntity,
  DouyinUserStats,
} from '../entities/douyin-user.entity';

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

function pickStats(raw: AnyObj): DouyinUserStats | undefined {
  const stats: DouyinUserStats = {
    awemeCount: asNumber(raw.aweme_count) ?? asNumber(raw.awemeCount),
    followerCount:
      asNumber(raw.follower_count) ??
      asNumber(raw.followerCount) ??
      asNumber(raw.mplatform_followers_count),
    followingCount:
      asNumber(raw.following_count) ?? asNumber(raw.followingCount),
    totalFavorited:
      asNumber(raw.total_favorited) ?? asNumber(raw.totalFavorited),
    favoritingCount:
      asNumber(raw.favoriting_count) ?? asNumber(raw.favoritingCount),
  };
  const allEmpty = Object.values(stats).every((v) => v === undefined);
  return allEmpty ? undefined : stats;
}

/**
 * 解析抖音用户主页 user.info 字段（来源：/aweme/v1/web/user/profile/other/）。
 */
export function parseUserFromRaw(
  raw: unknown,
  secUserId: string,
  url: string,
): DouyinUserEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as AnyObj;
  const user = (r.user ?? r.userInfo ?? r) as AnyObj;
  if (!user) return null;
  const avatar =
    pickUrl(user.avatar_thumb) ??
    pickUrl(user.avatar_medium) ??
    pickUrl(user.avatar_larger) ??
    pickUrl(user.avatar);
  return {
    secUserId: asString(user.sec_uid) ?? asString(user.secUserId) ?? secUserId,
    uniqueId: asString(user.unique_id),
    shortId: asString(user.short_id),
    url,
    nickname: asString(user.nickname),
    signature: asString(user.signature),
    avatar,
    gender:
      asNumber(user.gender) === 1
        ? 'male'
        : asNumber(user.gender) === 2
          ? 'female'
          : asString(user.gender),
    ipLocation: asString(user.ip_location) ?? asString(user.ipLocation),
    stats: pickStats(user),
    fetchedAt: new Date().toISOString(),
    source: 'douyin',
    raw: user,
  };
}

/** 解析作品分页接口 /aweme/post/ 返回的 aweme_list -> 摸要。 */
export function parseRecentAwemes(payload: unknown): DouyinRecentAweme[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as AnyObj;
  const list = (root.aweme_list ?? root.awemeList ?? []) as AnyObj[];
  if (!Array.isArray(list)) return [];
  const out: DouyinRecentAweme[] = [];
  for (const a of list) {
    const id = asString(a.aweme_id) ?? asString(a.awemeId);
    if (!id) continue;
    out.push({
      awemeId: id,
      desc: asString(a.desc),
      cover:
        pickUrl((a.video as AnyObj)?.cover) ??
        pickUrl((a.video as AnyObj)?.origin_cover),
      diggCount:
        asNumber((a.statistics as AnyObj)?.digg_count) ??
        asNumber((a.statistics as AnyObj)?.diggCount),
      createTime: unixToIso(a.create_time),
    });
  }
  return out;
}
