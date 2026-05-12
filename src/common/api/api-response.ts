/**
 * 统一响应壳 — agent 可稳定解析的成功/失败结构。
 * 成功:  { success: true,  code: "OK",  data: T,  traceId, ts }
 * 失败:  { success: false, code: "...", message, details?, traceId, ts }
 */
export interface ApiSuccess<T> {
  success: true;
  code: 'OK';
  data: T;
  traceId: string;
  ts: string;
}

export interface ApiError {
  success: false;
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
  ts: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
