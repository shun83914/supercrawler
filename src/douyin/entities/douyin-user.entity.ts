export interface DouyinUserStats {
  awemeCount?: number;
  followerCount?: number;
  followingCount?: number;
  totalFavorited?: number;
  favoritingCount?: number;
}

export interface DouyinRecentAweme {
  awemeId: string;
  desc?: string;
  cover?: string;
  diggCount?: number;
  createTime?: string;
}

export interface DouyinUserEntity {
  secUserId: string;
  uniqueId?: string;
  shortId?: string;
  url: string;
  nickname?: string;
  signature?: string;
  avatar?: string;
  gender?: string;
  ipLocation?: string;
  stats?: DouyinUserStats;
  recentAwemes?: DouyinRecentAweme[];
  fetchedAt: string;
  source: 'douyin';
  raw?: unknown;
}
