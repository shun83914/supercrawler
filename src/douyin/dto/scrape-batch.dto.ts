import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { DOUYIN_SEARCH_SORTS } from './scrape.dto';
import type { DouyinSearchSort } from './scrape.dto';

export const DOUYIN_BATCH_TYPES = [
  'aweme',
  'user',
  'search',
  'comments',
] as const;
export type DouyinBatchType = (typeof DOUYIN_BATCH_TYPES)[number];

export class DouyinBatchTaskDto {
  @IsIn(DOUYIN_BATCH_TYPES)
  type!: DouyinBatchType;

  /** aweme/comments: awemeId; user: secUserId; search: keyword */
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsIn(DOUYIN_SEARCH_SORTS)
  sort?: DouyinSearchSort;

  @IsOptional()
  limit?: number;
}

export class DouyinScrapeBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DouyinBatchTaskDto)
  tasks!: DouyinBatchTaskDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}
