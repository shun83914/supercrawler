import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { nowDate, nowStamp } from '../common/utils/datetime.util';

export type ScrapeTarget =
  | 'note'
  | 'user'
  | 'search'
  | 'comments'
  | 'douyin-aweme'
  | 'douyin-user'
  | 'douyin-search'
  | 'douyin-comments';

@Injectable()
export class FileNamingService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 生成 JSONL 文件绝对路径：{OUTPUT_DIR}/{YYYY-MM-DD}/{target}-{YYYYMMDD-HHmmss}.jsonl
   */
  build(target: ScrapeTarget, suffix?: string): string {
    const base = this.config.get<string>('outputDir') || './data/output';
    const dir = path.resolve(base, nowDate());
    const stamp = nowStamp();
    const safeSuffix = suffix ? `-${suffix.replace(/[^\w.-]/g, '_')}` : '';
    return path.join(dir, `${target}-${stamp}${safeSuffix}.jsonl`);
  }
}
