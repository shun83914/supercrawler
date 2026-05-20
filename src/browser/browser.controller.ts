import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('browser')
@Controller('browser')
export class BrowserController {
  @Get('status')
  @ApiOperation({
    summary: '检查浏览器就绪状态',
    description:
      '检查 Chromium 浏览器是否已下载并就绪。使用 CloakBrowser 官方 API 进行检查。',
  })
  async getBrowserStatus(): Promise<{
    ready: boolean;
    downloading: boolean;
    path?: string;
    chromePath?: string;
    size?: string;
    message: string;
  }> {
    try {
      // 动态加载 CloakBrowser
      const cloak = await (async () => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        return (await new Function('return import("cloakbrowser")')()) as typeof import('cloakbrowser');
      })();

      // 使用 CloakBrowser 官方 API
      const info = await cloak.binaryInfo();

      return {
        ready: info.installed,
        downloading: false,
        path: info.cacheDir,
        chromePath: info.binaryPath,
        size: 'N/A',
        message: info.installed
          ? `Chromium 浏览器已就绪 (v${info.version}, ${info.platform})`
          : 'Chromium 浏览器未安装，将在首次使用时自动下载',
      };
    } catch (error) {
      return {
        ready: false,
        downloading: false,
        message: `检查浏览器状态失败: ${error.message}`,
      };
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
}
