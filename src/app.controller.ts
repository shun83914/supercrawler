import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/guards/api-key.guard';
import { AppService, HealthReport } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: '健康检查 + 账号/并发/缓存状态（agent 决策用）' })
  health(): Promise<HealthReport> {
    return this.appService.health();
  }
}
