export interface UserEntity {
  userId: string;
  url: string;
  nickname?: string;
  avatar?: string;
  desc?: string;
  gender?: string;
  ipLocation?: string;
  fansCount?: number;
  followsCount?: number;
  likedAndCollectedCount?: number;
  notesCount?: number;
  tags?: string[];
  notes?: Array<{
    noteId: string;
    title?: string;
    cover?: string;
    likedCount?: number;
    type?: string;
  }>;
  fetchedAt: string;
  source: 'xhs';
  raw?: unknown;
}
