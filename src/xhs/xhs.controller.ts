import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScrapeBatchDto } from './dto/scrape-batch.dto';
import {
  ScrapeCommentsDto,
  ScrapeNoteDto,
  ScrapeSearchDto,
  ScrapeUserDto,
} from './dto/scrape.dto';
import { BatchSummary, ScrapeSummary, XhsService } from './xhs.service';

@ApiTags('xhs')
@Controller('xhs')
export class XhsController {
  constructor(private readonly xhs: XhsService) {}

  @Post('notes')
  @ApiOperation({ summary: '按 noteId 数组抓取笔记详情' })
  notes(@Body() dto: ScrapeNoteDto): Promise<ScrapeSummary> {
    return this.xhs.scrapeNotes(dto);
  }

  @Post('users')
  @ApiOperation({ summary: '抓取单个用户主页及其最近笔记' })
  users(@Body() dto: ScrapeUserDto): Promise<ScrapeSummary> {
    return this.xhs.scrapeUser(dto);
  }

  @Post('search')
  @ApiOperation({ summary: '按外部传入关键词列表抓取搜索结果' })
  search(@Body() dto: ScrapeSearchDto): Promise<ScrapeSummary> {
    return this.xhs.scrapeSearch(dto);
  }

  @Post('comments')
  @ApiOperation({ summary: '抓取指定笔记的评论（XHR 监听 + 滚动加载）' })
  comments(@Body() dto: ScrapeCommentsDto): Promise<ScrapeSummary> {
    return this.xhs.scrapeComments(dto);
  }

  @Post('batch')
  @ApiOperation({
    summary: '混合批量：tasks=[{type:note|user|search|comments,id,...}]',
  })
  batch(@Body() dto: ScrapeBatchDto): Promise<BatchSummary> {
    return this.xhs.runBatch(dto);
  }
}
