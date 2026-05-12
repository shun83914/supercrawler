import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountIdQueryDto, LoginDto } from './dto/login.dto';
import { AuthService, LoginStatus } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary:
      '打开 headed 浏览器等待扫码登录（阻塞直到成功或超时）；platform 默认 xhs，可选 douyin',
  })
  login(@Body() dto: LoginDto): Promise<LoginStatus> {
    return this.auth.loginInteractive(
      dto.accountId,
      dto.proxy,
      dto.platform ?? 'xhs',
    );
  }

  @Get('status')
  @ApiOperation({
    summary: '查询指定账号的登录态（无头探测）；platform 默认 xhs，可选 douyin',
  })
  status(@Query() query: AccountIdQueryDto): Promise<LoginStatus> {
    return this.auth.checkStatus(query.accountId, query.platform ?? 'xhs');
  }

  @Delete('logout')
  @ApiOperation({ summary: '关闭指定账号的 context（profile 保留）' })
  async logout(
    @Query() query: AccountIdQueryDto,
  ): Promise<{ accountId: string; closed: boolean }> {
    await this.auth.logout(query.accountId);
    return { accountId: query.accountId, closed: true };
  }
}
