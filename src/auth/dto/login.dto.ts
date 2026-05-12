import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export type AuthPlatform = 'xhs' | 'douyin';

const ACCOUNT_RX = /^[\w.-]{1,64}$/;

export class LoginDto {
  @IsString()
  @Matches(ACCOUNT_RX, {
    message: 'accountId only allows [A-Za-z0-9_.-], length 1-64',
  })
  accountId!: string;

  @IsOptional()
  @IsIn(['xhs', 'douyin'])
  platform?: AuthPlatform;

  @IsOptional()
  @IsString()
  proxy?: string;
}

export class AccountIdQueryDto {
  @IsString()
  @Matches(ACCOUNT_RX)
  accountId!: string;

  @IsOptional()
  @IsIn(['xhs', 'douyin'])
  platform?: AuthPlatform;
}
