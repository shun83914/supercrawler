import { HttpException } from '@nestjs/common';
import { ErrorCode, ERROR_CODE_TO_HTTP } from './error-code';

/**
 * 业务异常 — 抛出后会被全局过滤器映射成统一壳响应。
 * agent 可以通过响应中的 code 字段直接判定。
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    const status = ERROR_CODE_TO_HTTP[code] ?? 500;
    super({ code, message: message ?? code, details }, status);
    this.code = code;
    this.details = details;
  }
}

/**
 * 把任意 unknown 错误归一化为 BusinessException。
 * - 已经是 BusinessException 直接返回
 * - Playwright 的导航/超时错误归类
 * - 其他 fallback 为 INTERNAL_ERROR
 */
export function normalizeError(err: unknown): BusinessException {
  if (err instanceof BusinessException) return err;
  if (err instanceof Error) {
    const msg = err.message;
    if (/timeout|TimeoutError/i.test(msg)) {
      return new BusinessException(ErrorCode.TIMEOUT, msg);
    }
    if (/net::ERR|navigation|ERR_FAILED|net error/i.test(msg)) {
      return new BusinessException(ErrorCode.NAVIGATION_FAILED, msg);
    }
    return new BusinessException(ErrorCode.INTERNAL_ERROR, msg);
  }
  return new BusinessException(ErrorCode.INTERNAL_ERROR, String(err));
}
