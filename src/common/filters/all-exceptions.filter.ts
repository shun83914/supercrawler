import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { ApiError } from '../api/api-response';
import { BusinessException, normalizeError } from '../errors/business.exception';
import { ErrorCode } from '../errors/error-code';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { traceId?: string }>();
    const traceId = request.traceId ?? (request.headers['x-trace-id'] as string | undefined) ?? uuidv4();

    const biz = this.toBusiness(exception);
    const status = biz.getStatus();
    const respPayload = biz.getResponse() as { code: ErrorCode; message: string; details?: unknown };

    this.logger.error(
      `${request.method} ${request.url} -> ${status} ${respPayload.code}: ${respPayload.message} traceId=${traceId}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const body: ApiError = {
      success: false,
      code: respPayload.code,
      message: respPayload.message,
      details: respPayload.details,
      traceId,
      ts: new Date().toISOString(),
    };
    response.status(status).json(body);
  }

  private toBusiness(exception: unknown): BusinessException {
    if (exception instanceof BusinessException) return exception;
    if (exception instanceof BadRequestException) {
      const r = exception.getResponse() as { message?: unknown };
      return new BusinessException(
        ErrorCode.INVALID_INPUT,
        Array.isArray(r.message) ? r.message.join('; ') : (r.message as string) ?? 'invalid input',
      );
    }
    if (exception instanceof HttpException) {
      const r = exception.getResponse();
      const msg = typeof r === 'string' ? r : (r as { message?: unknown }).message;
      return new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        Array.isArray(msg) ? msg.join('; ') : (msg as string) ?? exception.message,
      );
    }
    return normalizeError(exception);
  }
}
