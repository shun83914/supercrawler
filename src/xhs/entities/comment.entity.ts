export interface CommentEntity {
  commentId: string;
  noteId: string;
  parentId?: string;
  content: string;
  likedCount?: number;
  subCount?: number;
  ipLocation?: string;
  createdAt?: string;
  user?: {
    userId?: string;
    nickname?: string;
    avatar?: string;
  };
  fetchedAt: string;
  source: 'xhs';
  raw?: unknown;
}
