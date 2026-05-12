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
import { SEARCH_SORTS } from './scrape.dto';
import type { SearchSort } from './scrape.dto';

export const BATCH_TYPES = ['note', 'user', 'search', 'comments'] as const;
export type BatchType = (typeof BATCH_TYPES)[number];

export class BatchTaskDto {
  @IsIn(BATCH_TYPES)
  type!: BatchType;

  /** 针对 note / comments / search：单个 id 或 keyword */
  @IsOptional()
  @IsString()
  id?: string;

  /** 针对 search 的 sort */
  @IsOptional()
  @IsIn(SEARCH_SORTS)
  sort?: SearchSort;

  /** 限制条数 */
  @IsOptional()
  limit?: number;

  /** user 策略笔记数限制 */
  @IsOptional()
  noteLimit?: number;
}

export class ScrapeBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchTaskDto)
  tasks!: BatchTaskDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}
