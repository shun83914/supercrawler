import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { AppConfig } from '../config/configuration';
import { BusinessException } from '../common/errors/business.exception';
import { ErrorCode } from '../common/errors/error-code';

export interface PeekResult {
  file: string;
  total: number;
  offset: number;
  limit: number;
  items: unknown[];
}

/**
 * 读取 JSONL 文件，逐行解析；只允许读 OUTPUT_DIR 下的文件，防越权。
 */
@Injectable()
export class JsonlReaderService {
  private readonly logger = new Logger(JsonlReaderService.name);

  constructor(private readonly config: ConfigService) {}

  async peek(file: string, offset = 0, limit = 50): Promise<PeekResult> {
    const outRoot = path.resolve(this.config.get<AppConfig['outputDir']>('outputDir')!);
    const abs = path.resolve(file);
    if (!abs.startsWith(outRoot)) {
      throw new BusinessException(
        ErrorCode.STORAGE_PATH_FORBIDDEN,
        `path must be inside OUTPUT_DIR (${outRoot})`,
      );
    }
    if (!fs.existsSync(abs)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, `file not found: ${abs}`);
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(abs, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    const items: unknown[] = [];
    let total = 0;
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        if (total >= offset && items.length < limit) {
          try {
            items.push(JSON.parse(line));
          } catch {
            items.push({ _parseError: true, raw: line });
          }
        }
        total += 1;
      }
    } catch (err) {
      throw new BusinessException(
        ErrorCode.STORAGE_READ_FAILED,
        (err as Error).message,
      );
    }

    return { file: abs, total, offset, limit, items };
  }
}
