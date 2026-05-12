import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ScrapeResponseOptions } from '../../xhs/dto/scrape.dto';

export const DOUYIN_SEARCH_SORTS = ['general', 'latest', 'popular'] as const;
export type DouyinSearchSort = (typeof DOUYIN_SEARCH_SORTS)[number];

const ACCOUNT_RX = /^[\w.-]{1,64}$/;
/** 抖音 awemeId 一般为 19 位数字字符串。 */
const AWEME_ID_RX = /^\d{15,25}$/;
/** secUserId 一般为 base64url 风格短字符串。 */
const SEC_USER_ID_RX = /^[A-Za-z0-9_-]{20,80}$/;

export class ScrapeAwemeDto extends ScrapeResponseOptions {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(AWEME_ID_RX, {
    each: true,
    message: 'awemeId must be 15-25 digit string',
  })
  awemeIds!: string[];

  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_RX)
  accountId?: string;
}

export class ScrapeDouyinUserDto extends ScrapeResponseOptions {
  @IsString()
  @Matches(SEC_USER_ID_RX, { message: 'invalid douyin secUserId' })
  secUserId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_RX)
  accountId?: string;
}

export class ScrapeDouyinSearchDto extends ScrapeResponseOptions {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  keywords!: string[];

  @IsOptional()
  @IsIn(DOUYIN_SEARCH_SORTS)
  sort?: DouyinSearchSort;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_RX)
  accountId?: string;
}

export class ScrapeDouyinCommentsDto extends ScrapeResponseOptions {
  @IsString()
  @Matches(AWEME_ID_RX, { message: 'invalid douyin awemeId' })
  awemeId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_RX)
  accountId?: string;
}
