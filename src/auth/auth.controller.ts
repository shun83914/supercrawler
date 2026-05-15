import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { AccountIdQueryDto, LoginDto } from './dto/login.dto';
import { AuthService, LoginStatus } from './auth.service';

const execAsync = promisify(exec);

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

  @Post('cleanup')
  @ApiOperation({
    summary: '清理过期平台的登录数据',
    description:
      '清理指定账号和平台的过期登录数据（cookies + 元数据）。' +
      '默认只在过期超过 7 天后清理，可设置 force=true 强制清理。',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        accountId: { type: 'string', default: 'default' },
        platform: { type: 'string', enum: ['xhs', 'douyin'], default: 'xhs' },
        force: { type: 'boolean', default: false },
      },
    },
  })
  async cleanup(
    @Body() body: { accountId?: string; platform?: 'xhs' | 'douyin'; force?: boolean },
  ): Promise<{ cleaned: boolean; reason?: string }> {
    const accountId = body.accountId || 'default';
    const platform = body.platform || 'xhs';
    const force = body.force || false;
    return this.auth.cleanupExpiredData(accountId, platform, force);
  }

  @Get('qr-screenshot')
  @ApiOperation({
    summary: '获取登录二维码截图（Headed + Xvfb 模式）',
    description:
      '在 Headed 模式下，自动截取虚拟显示器中的二维码，返回 base64 图片。' +
      '使用前请确保：1) CLOAK_HEADLESS=false 2) 已触发登录 3) 等待 3-5 秒让页面加载',
  })
  async getQrScreenshot(
    @Query('platform') platform?: 'xhs' | 'douyin',
  ): Promise<{
    success: boolean;
    qrCode?: string;
    error?: string;
  }> {
    try {
      const plat = platform ?? 'xhs';
      const qrPath = `/tmp/qr-code-${plat}.png`;

      // 执行 scrot 截图（通过 DISPLAY 环境变量指定虚拟显示器）
      await execAsync('DISPLAY=:99 scrot /tmp/qr-code-current.png -q 90');

      // 检查文件是否存在
      if (!fs.existsSync('/tmp/qr-code-current.png')) {
        return {
          success: false,
          error: '截图文件未生成，请确认：1) Xvfb 已启动 2) 浏览器已打开',
        };
      }

      // 读取图片并转 base64
      const imgBuffer = await fs.promises.readFile('/tmp/qr-code-current.png');
      const base64 = imgBuffer.toString('base64');

      // 保存到平台特定路径（便于后续查看）
      await fs.promises.copyFile('/tmp/qr-code-current.png', qrPath);

      return {
        success: true,
        qrCode: `data:image/png;base64,${base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `截图失败: ${error.message}`,
      };
    }
  }
}
