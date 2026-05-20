import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { AccountIdQueryDto, LoginDto } from './dto/login.dto';
import { AuthService, LoginStatus } from './auth.service';
import { LoginMetadataService } from './login-metadata.service';

const execAsync = promisify(exec);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly metadataService: LoginMetadataService;

  constructor(private readonly auth: AuthService) {
    // 手动创建 LoginMetadataService 实例（因为需要 profileDir 参数）
    const profileDir = process.env.PROFILE_DIR || './data/profiles';
    this.metadataService = new LoginMetadataService(profileDir);
  }

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

  @Get('profile-status')
  @ApiOperation({
    summary: '诊断 Profile 状态',
    description:
      '检查指定账号的 profile 目录状态，包括：锁文件、元数据、Cookie 等。' +
      '用于诊断登录失败、搜索失败等问题。',
  })
  async getProfileStatus(
    @Query('accountId') accountId = 'default',
  ): Promise<{
    accountId: string;
    profileExists: boolean;
    lockFiles: { singletonLock: boolean; singletonSocket: boolean };
    metadata: { xhs?: any; douyin?: any };
    message: string;
  }> {
    const profileDir = process.env.PROFILE_DIR || './data/profiles';
    const accountDir = path.join(profileDir, accountId);
    
    const result: {
      accountId: string;
      profileExists: boolean;
      lockFiles: { singletonLock: boolean; singletonSocket: boolean };
      metadata: { xhs?: any; douyin?: any };
      message: string;
    } = {
      accountId,
      profileExists: fs.existsSync(accountDir),
      lockFiles: {
        singletonLock: false,
        singletonSocket: false,
      },
      metadata: {},
      message: '',
    };

    if (!result.profileExists) {
      result.message = 'Profile 目录不存在（从未登录）';
      return result;
    }

    // 检查锁文件
    result.lockFiles.singletonLock = fs.existsSync(path.join(accountDir, 'SingletonLock'));
    result.lockFiles.singletonSocket = fs.existsSync(path.join(accountDir, 'SingletonSocket'));

    // 检查元数据
    try {
      result.metadata.xhs = await this.metadataService.read(accountId, 'xhs');
      result.metadata.douyin = await this.metadataService.read(accountId, 'douyin');
    } catch {
      // 忽略元数据读取错误
    }

    // 生成诊断信息
    const issues: string[] = [];
    if (result.lockFiles.singletonLock || result.lockFiles.singletonSocket) {
      issues.push('存在残留锁文件（可能有浏览器实例在运行）');
    }
    if (!result.metadata.xhs && !result.metadata.douyin) {
      issues.push('无登录元数据（可能未登录或元数据已清理）');
    }

    result.message = issues.length > 0 
      ? `发现 ${issues.length} 个问题: ${issues.join('; ')}`
      : 'Profile 状态正常';

    return result;
  }

  @Get('qr-screenshot')
  @ApiOperation({
    summary: '获取登录二维码截图（Headed + Xvfb 模式）',
    description:
      '在 Headed 模式下，自动截取虚拟显示器中的二维码，返回 base64 图片。' +
      '使用前请确保：1) CLOAK_HEADLESS=false 2) Chromium 已下载完成 3) 已触发登录 4) 等待 3-5 秒让页面加载',
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

      const fs = await import('fs');
      const path = await import('path');

      // 1. 检查是否在 Headed 模式下运行
      if (process.env.CLOAK_HEADLESS === 'true') {
        return {
          success: false,
          error: '当前运行在 Headless 模式，无法截图。请使用 Headed 模式（CLOAK_HEADLESS=false）启动容器。',
        };
      }

      // 2. 检查 Xvfb 是否运行
      try {
        await execAsync('xdpyinfo -display :99 >/dev/null 2>&1');
      } catch {
        return {
          success: false,
          error: 'Xvfb 虚拟显示器未运行。请使用 CLOAK_HEADLESS=false 启动容器。',
        };
      }

      // 3. 检查 Chromium 浏览器是否已下载
      // CloakBrowser 实际路径（支持环境变量配置）
      const browsersPath = process.env.CLOAK_BROWSER_PATH || '/root/.cloakbrowser';
      
      try {
        const dirs = fs.readdirSync(browsersPath).filter((d) => 
          d.startsWith('chromium-')
        );
        
        if (dirs.length === 0) {
          return {
            success: false,
            error: 'Chromium 浏览器未找到。请检查 Docker 镜像是否预装了浏览器。\n提示: GET /api/browser/status',
          };
        }

        const chromiumDir = path.join(browsersPath, dirs[0]);
        // CloakBrowser 的可执行文件直接在根目录
        const chromePath = path.join(chromiumDir, 'chrome');
        
        if (!fs.existsSync(chromePath)) {
          return {
            success: false,
            error: 'Chromium 浏览器目录存在但缺少可执行文件。请检查浏览器完整性。',
          };
        }
      } catch (err) {
        return {
          success: false,
          error: `Chromium 浏览器未找到: ${err.message}。请等待浏览器下载完成。`,
        };
      }

      // 4. 检查是否有 Chromium 进程在运行（关键！）
      try {
        const { stdout } = await execAsync('ps aux | grep -E "chrome|chromium" | grep -v grep | wc -l');
        const processCount = parseInt(stdout.trim(), 10);
        
        if (processCount === 0) {
          return {
            success: false,
            error: '未检测到 Chromium 进程。请先触发登录：POST /api/auth/login，然后等待 5-10 秒',
          };
        }
      } catch {
        // 忽略进程检查错误，继续尝试截图
      }

      // 5. 执行 scrot 截图（通过 DISPLAY 环境变量指定虚拟显示器）
      await execAsync('DISPLAY=:99 scrot /tmp/qr-code-current.png -q 90');

      // 6. 检查文件是否存在
      if (!fs.existsSync('/tmp/qr-code-current.png')) {
        return {
          success: false,
          error: '截图文件未生成，请确认：1) Xvfb 已启动 2) 浏览器已打开',
        };
      }

      // 7. 检查截图是否为空或太小（可能是黑屏）
      const stats = await fs.promises.stat('/tmp/qr-code-current.png');
      if (stats.size < 1000) {
        return {
          success: false,
          error: '截图文件太小（可能是黑屏）。请确认：1) 已触发登录 2) 浏览器已加载完成 3) 等待 5-10 秒后重试',
        };
      }

      // 8. 读取图片并转 base64
      const imgBuffer = await fs.promises.readFile('/tmp/qr-code-current.png');
      const base64 = imgBuffer.toString('base64');

      // 9. 保存到平台特定路径（便于后续查看）
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
