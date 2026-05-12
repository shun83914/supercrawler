import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * 响应控制选项（面向 agent）：
 * - includeRecords: 是否返回明细 records（默认 false，仅返文件路径+计数+摸要）
 * - includeRaw: 仅在 includeRecords=true 时生效，是否保留 raw 字段（默认 false）
 * - maxRecords: 返回 records 的上限（默认 50）
 * - useCache: 是否使用幂等缓存（默认 true）
 */
export class ScrapeResponseOptions {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeRecords?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeRaw?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  @Type(() => Number)
  maxRecords?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  useCache?: boolean;
}

export class ScrapeNoteDto extends ScrapeResponseOptions {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  noteIds!: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}

export class ScrapeUserDto extends ScrapeResponseOptions {
  @IsString()
  @Matches(/^[A-Za-z0-9]{16,32}$/, { message: 'invalid xhs userId' })
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  noteLimit?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}

export const SEARCH_SORTS = ['general', 'latest', 'popular'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export class ScrapeSearchDto extends ScrapeResponseOptions {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  keywords!: string[];

  @IsOptional()
  @IsIn(SEARCH_SORTS)
  sort?: SearchSort;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;

  /** ISO 8601；仅保留发布时间 >= 该值的记录。 */
  @IsOptional()
  @IsISO8601()
  publishedAfter?: string;

  /** ISO 8601；仅保留发布时间 <= 该值的记录。 */
  @IsOptional()
  @IsISO8601()
  publishedBefore?: string;

  /** 点赞数下限（依赖 likedCount 数值，如未返回则该记录被过滤）。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minLikes?: number;

  /** 笔记类型过滤。 */
  @IsOptional()
  @IsIn(['normal', 'video'])
  noteType?: 'normal' | 'video';
}

export class ScrapeCommentsDto extends ScrapeResponseOptions {
  @IsString()
  noteId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}
