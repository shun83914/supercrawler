import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { ApiSuccess } from './api-response';

/**
 * 统一把 controller 返回值包成 ApiSuccess 壳。
 * 已是壳的（success 字段存在）原样下发，便于内部直接构造。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { traceId?: string }>();
    const traceId = req.traceId ?? (req.headers['x-trace-id'] as string | undefined) ?? uuidv4();
    req.traceId = traceId;

    return next.handle().pipe(
      map((data: unknown) => {
        if (data && typeof data === 'object' && 'success' in (data as object)) {
          return data;
        }
        const wrapped: ApiSuccess<unknown> = {
          success: true,
          code: 'OK',
          data,
          traceId,
          ts: new Date().toISOString(),
        };
        return wrapped;
      }),
    );
  }
}
