import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileNamingService, ScrapeTarget } from './file-naming.service';

export interface WriteResult {
  file: string;
  count: number;
}

@Injectable()
export class JsonlWriterService {
  private readonly logger = new Logger(JsonlWriterService.name);

  constructor(private readonly naming: FileNamingService) {}

  /**
   * 追加写入一组记录到 JSONL 文件，每条记录占一行。
   * 如果未提供 filePath 则自动按 target 生成新文件。
   */
  async append<T>(
    target: ScrapeTarget,
    records: T[],
    opts?: { filePath?: string; suffix?: string },
  ): Promise<WriteResult> {
    const filePath = opts?.filePath ?? this.naming.build(target, opts?.suffix);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    if (records.length === 0) {
      // 仍然 touch 文件，方便外部观察任务执行
      await fs.promises.appendFile(filePath, '', 'utf8');
      return { file: filePath, count: 0 };
    }
    const payload = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await fs.promises.appendFile(filePath, payload, 'utf8');
    this.logger.log(`append ${records.length} records -> ${filePath}`);
    return { file: filePath, count: records.length };
  }
}
