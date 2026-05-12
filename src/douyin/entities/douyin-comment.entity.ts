export interface DouyinCommentUser {
  secUserId?: string;
  uid?: string;
  nickname?: string;
  avatar?: string;
}

export interface DouyinCommentEntity {
  cid: string;
  awemeId: string;
  parentCid?: string;
  text: string;
  diggCount?: number;
  replyCount?: number;
  createTime?: string;
  ipLocation?: string;
  user?: DouyinCommentUser;
  fetchedAt: string;
  source: 'douyin';
  raw?: unknown;
}
