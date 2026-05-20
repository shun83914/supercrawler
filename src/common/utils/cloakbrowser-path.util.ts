import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 获取 CloakBrowser 的跨平台路径
 * 
 * 路径规则：
 * - 环境变量 CLOAK_BROWSER_PATH 优先（用于自定义路径）
 * - macOS/Linux: ~/.cloakbrowser (用户主目录)
 * - Windows: %USERPROFILE%/.cloakbrowser
 * - Docker 容器: /root/.cloakbrowser (root 用户)
 */
export function getCloakBrowserPath(): string {
  // 1. 环境变量优先
  const envPath = process.env.CLOAK_BROWSER_PATH;
  if (envPath) {
    return envPath;
  }

  // 2. 检测运行环境
  const platform = os.platform();
  const home = os.homedir();
  const username = os.userInfo().username;

  // 3. Docker 容器检测（root 用户且 HOME=/root）
  if (username === 'root' && home === '/root') {
    return '/root/.cloakbrowser';
  }

  // 4. 根据操作系统返回路径
  switch (platform) {
    case 'darwin': // macOS
      return path.join(home, '.cloakbrowser');
    
    case 'linux': // Linux
      // 普通 Linux 用户使用主目录
      return path.join(home, '.cloakbrowser');
    
    case 'win32': // Windows
      return path.join(home, '.cloakbrowser');
    
    default:
      // 其他系统默认使用主目录
      return path.join(home, '.cloakbrowser');
  }
}

/**
 * 获取当前系统信息（用于调试）
 */
export function getSystemInfo(): {
  platform: string;
  home: string;
  username: string;
  cloakBrowserPath: string;
  isDocker: boolean;
} {
  const platform = os.platform();
  const home = os.homedir();
  const username = os.userInfo().username;
  const isDocker = username === 'root' && home === '/root';
  
  return {
    platform,
    home,
    username,
    cloakBrowserPath: getCloakBrowserPath(),
    isDocker,
  };
}
