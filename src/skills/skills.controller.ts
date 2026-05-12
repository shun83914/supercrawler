import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/guards/api-key.guard';
import { SKILL_MANIFEST } from './skill.manifest';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  @Public()
  @Get('manifest')
  @ApiOperation({
    summary: '返回服务对外暴露的全部 skill 清单（供 agent 自动挂载）',
  })
  manifest() {
    return {
      version: '1.0',
      service: 'supercrawler',
      skills: SKILL_MANIFEST,
    };
  }
}
