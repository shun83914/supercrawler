export interface NoteImage {
  url: string;
  width?: number;
  height?: number;
}

export interface NoteVideo {
  url: string;
  duration?: number;
}

export interface NoteAuthor {
  userId?: string;
  nickname?: string;
  avatar?: string;
}

export interface NoteEntity {
  noteId: string;
  url: string;
  type?: 'normal' | 'video' | string;
  title?: string;
  content?: string;
  tags?: string[];
  images?: NoteImage[];
  video?: NoteVideo;
  likedCount?: number;
  collectedCount?: number;
  commentCount?: number;
  shareCount?: number;
  author?: NoteAuthor;
  publishedAt?: string;
  ipLocation?: string;
  fetchedAt: string;
  source: 'xhs';
  raw?: unknown;
}
