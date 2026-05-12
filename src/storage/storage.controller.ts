import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JsonlReaderService, PeekResult } from './jsonl-reader.service';

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly reader: JsonlReaderService) {}

  @Get('peek')
  @ApiOperation({ summary: '按文件路径分页读取 JSONL 抓取结果（限制在 OUTPUT_DIR 内）' })
  @ApiQuery({ name: 'file', required: true })
  @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', default: 0 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 50 } })
  peek(
    @Query('file') file: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<PeekResult> {
    return this.reader.peek(file, offset, Math.min(Math.max(limit, 1), 500));
  }
}
