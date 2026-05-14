import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration';
import { BusinessException } from '../errors/business.exception';
import { ErrorCode } from '../errors/error-code';

export const PUBLIC_ENDPOINT = 'public_endpoint';
/** 标记为公开端点：跳过鉴权（如 /health、/skills/manifest）。 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ENDPOINT, true);

/**
 * 通过 Header `X-API-Key` 或 `Authorization: Bearer xxx` 鉴权。
 * 配置 API_TOKEN 为空时全部放行（开发态默认）。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expected = this.config.get('apiToken', { infer: true });
    this.logger.debug(`API Token check: expected=${expected ? '***' + expected.slice(-8) : '(empty)'}, env.API_TOKEN=${process.env.API_TOKEN ? '***' + process.env.API_TOKEN.slice(-8) : '(empty)'}`);
    if (!expected) return true; // 未配置 token 时直接放行

    const req = context.switchToHttp().getRequest<Request>();
    const headerKey = (req.headers['x-api-key'] as string | undefined)?.trim();
    const auth = (req.headers['authorization'] as string | undefined)?.trim();
    const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined;
    const provided = headerKey || bearer;

    if (!provided || provided !== expected) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'invalid or missing api key (X-API-Key / Authorization: Bearer)',
      );
    }
    return true;
  }
}
