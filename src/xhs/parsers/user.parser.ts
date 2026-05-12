import type { UserEntity } from '../entities/user.entity';

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

export function parseUserFromState(
  state: unknown,
  userId: string,
  url: string,
): UserEntity | null {
  if (!state || typeof state !== 'object') return null;
  const root = state as AnyObj;
  const userRoot = (root.user ?? root.userStore ?? {}) as AnyObj;
  const info = (userRoot.info ?? userRoot.userPageData ?? userRoot.userInfo ?? userRoot) as AnyObj;
  const basic = (info.basicInfo ?? info) as AnyObj;
  const interactions = (info.interactions ?? {}) as AnyObj;

  const fansCount =
    asNumber((interactions as AnyObj).fans) ??
    asNumber((info as AnyObj).fansCount) ??
    asNumber((info as AnyObj).fans);
  const followsCount =
    asNumber((interactions as AnyObj).follows) ??
    asNumber((info as AnyObj).followsCount);
  const likedAndCollectedCount =
    asNumber((interactions as AnyObj).interaction) ??
    asNumber((info as AnyObj).likedAndCollected);

  const tags = Array.isArray(basic.tags)
    ? (basic.tags as AnyObj[]).map((t) => asString(t.name) ?? asString(t)).filter(Boolean) as string[]
    : undefined;

  return {
    userId,
    url,
    nickname: asString(basic.nickname) ?? asString(basic.name),
    avatar: asString(basic.imageb) ?? asString(basic.avatar) ?? asString(basic.images),
    desc: asString(basic.desc),
    gender:
      asString(basic.gender) === '1'
        ? 'male'
        : asString(basic.gender) === '2'
          ? 'female'
          : asString(basic.gender),
    ipLocation: asString(basic.ipLocation) ?? asString(basic.ip_location),
    fansCount,
    followsCount,
    likedAndCollectedCount,
    tags,
    fetchedAt: new Date().toISOString(),
    source: 'xhs',
    raw: info,
  };
}
