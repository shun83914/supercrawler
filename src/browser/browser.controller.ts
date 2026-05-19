import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';

@ApiTags('browser')
@Controller('browser')
export class BrowserController {
  @Get('status')
  @ApiOperation({
    summary: '检查浏览器就绪状态',
    description:
      '检查 Chromium 浏览器是否已下载并就绪。首次启动时需要下载浏览器，' +
      '下载完成前无法执行登录流程。',
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
      // CloakBrowser 实际存储路径（通过环境变量配置）
      const cloakBrowserPath = process.env.CLOAK_BROWSER_PATH || '/root/.cloakbrowser';
      
      // 查找 chromium 目录
      let chromiumDirs: string[] = [];
      
      try {
        const dirs = fs.readdirSync(cloakBrowserPath);
        chromiumDirs = dirs.filter(d => d.startsWith('chromium-'));
      } catch {
        // 目录不存在
      }

      if (chromiumDirs.length > 0) {
        const chromiumDir = path.join(cloakBrowserPath, chromiumDirs[0]);
        const stats = fs.statSync(chromiumDir);
        
        // CloakBrowser 的可执行文件路径（直接在根目录）
        const chromePath = path.join(chromiumDir, 'chrome');
        const exists = fs.existsSync(chromePath);

        return {
          ready: exists,
          downloading: false,
          path: chromiumDir,
          chromePath: exists ? chromePath : undefined,
          size: this.formatSize(stats.size),
          message: exists 
            ? `Chromium 浏览器已就绪 (${chromiumDirs[0]})`
            : 'Chromium 目录存在但缺少可执行文件，可能正在下载或下载失败',
        };
      } else {
        return {
          ready: false,
          downloading: false,
          message: `Chromium 浏览器未下载，将在首次启动时自动下载（路径: ${cloakBrowserPath}）`,
        };
      }
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
