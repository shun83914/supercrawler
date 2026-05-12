export interface AwemeAuthor {
  secUserId?: string;
  uid?: string;
  uniqueId?: string;
  nickname?: string;
  avatar?: string;
  signature?: string;
}

export interface AwemeStats {
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  playCount?: number;
}

export interface AwemeVideo {
  /** 仅保留可访问的 URL，不下载二进制 */
  playAddr?: string;
  coverUrl?: string;
  duration?: number;
  ratio?: string;
  width?: number;
  height?: number;
}

export interface AwemeMusic {
  id?: string;
  title?: string;
  author?: string;
  playUrl?: string;
  duration?: number;
}

export interface AwemeEntity {
  awemeId: string;
  url: string;
  title?: string;
  desc?: string;
  createTime?: string;
  /** 'video' | 'image' | 'note' 等 */
  type?: string;
  author?: AwemeAuthor;
  stats?: AwemeStats;
  video?: AwemeVideo;
  music?: AwemeMusic;
  tags?: string[];
  ipLocation?: string;
  fetchedAt: string;
  source: 'douyin';
  raw?: unknown;
}
