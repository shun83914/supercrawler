import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DouyinScrapeBatchDto } from './dto/scrape-batch.dto';
import {
  ScrapeAwemeDto,
  ScrapeDouyinCommentsDto,
  ScrapeDouyinSearchDto,
  ScrapeDouyinUserDto,
} from './dto/scrape.dto';
import {
  DouyinBatchSummary,
  DouyinScrapeSummary,
  DouyinService,
} from './douyin.service';

@ApiTags('douyin')
@Controller('douyin')
export class DouyinController {
  constructor(private readonly douyin: DouyinService) {}

  @Post('awemes')
  @ApiOperation({ summary: '按 awemeId 数组抓取作品详情' })
  awemes(@Body() dto: ScrapeAwemeDto): Promise<DouyinScrapeSummary> {
    return this.douyin.scrapeAwemes(dto);
  }

  @Post('users')
  @ApiOperation({ summary: '抓取单个用户主页（secUserId）及其最近作品' })
  users(@Body() dto: ScrapeDouyinUserDto): Promise<DouyinScrapeSummary> {
    return this.douyin.scrapeUser(dto);
  }

  @Post('search')
  @ApiOperation({ summary: '按外部传入关键词列表抓取搜索结果' })
  search(@Body() dto: ScrapeDouyinSearchDto): Promise<DouyinScrapeSummary> {
    return this.douyin.scrapeSearch(dto);
  }

  @Post('comments')
  @ApiOperation({ summary: '抓取指定作品的评论（XHR 监听 + 滚动加载）' })
  comments(@Body() dto: ScrapeDouyinCommentsDto): Promise<DouyinScrapeSummary> {
    return this.douyin.scrapeComments(dto);
  }

  @Post('batch')
  @ApiOperation({
    summary: '混合批量：tasks=[{type:aweme|user|search|comments,id,...}]',
  })
  batch(@Body() dto: DouyinScrapeBatchDto): Promise<DouyinBatchSummary> {
    return this.douyin.runBatch(dto);
  }
}
