import type { BrowserContext, Page } from 'playwright-core';

/**
 * 反爬增强工具 - 浏览器指纹伪装和反检测
 */

/**
 * 常见的 User-Agent 列表（Chrome on macOS/Windows）
 */
const USER_AGENTS = [
  // Chrome 131 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 131 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 130 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

/**
 * 屏幕分辨率配置
 */
const SCREEN_SIZES = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 },
  { width: 1440, height: 900, availWidth: 1440, availHeight: 860 },
];

/**
 * 随机选择数组元素
 */
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成随机数（带噪声）
 */
function randomNoise(base: number, range: number): number {
  return base + Math.floor(Math.random() * range);
}

/**
 * 应用反爬增强到 BrowserContext
 * 在创建 context 后立即调用
 */
export async function applyAntiDetection(context: BrowserContext): Promise<void> {
  // 1. 在每个新页面应用反爬脚本
  context.on('page', (page) => {
    applyPageAntiDetection(page).catch(() => undefined);
  });

  // 2. 对已有的 page 也应用
  const pages = context.pages();
  await Promise.all(pages.map((page) => applyPageAntiDetection(page).catch(() => undefined)));
}

/**
 * 应用页面级别的反爬检测
 */
async function applyPageAntiDetection(page: Page): Promise<void> {
  try {
    await page.addInitScript(() => {
      // ===== 1. 隐藏 WebDriver 检测 =====
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // ===== 2. 伪装 Chrome 运行时信息 =====
      // @ts-ignore
      window.chrome = {
        runtime: {
          connect: () => {},
          onMessage: { addListener: () => {} },
        },
        // @ts-ignore
      };

      // ===== 3. 伪装 Permissions API =====
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters);

      // ===== 4. 隐藏 Playwright 特征 =====
      // @ts-ignore
      delete navigator.__proto__.webdriver;

      // ===== 5. 伪装 Plugins 集合 =====
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      // ===== 6. 伪装 Languages =====
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });

      // ===== 7. 添加 Canvas 指纹噪声 =====
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type: string, ...args: any[]) {
        if (type === 'image/png') {
          const ctx = this.getContext('2d');
          if (ctx) {
            // 添加微小的像素级噪声
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] = Math.min(255, imageData.data[i] + (Math.random() > 0.5 ? 1 : 0));
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
        return originalToDataURL.call(this, type, ...args);
      };

      // ===== 8. 伪装 WebGL 渲染器 =====
      const getParameter = WebGLRenderingContext?.prototype.getParameter;
      if (getParameter) {
        WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
          if (parameter === 37445) {
            return 'Google Inc. (Apple)';
          }
          if (parameter === 37446) {
            return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
          }
          return getParameter.call(this, parameter);
        };
      }

      // ===== 9. 移除自动化特征标记 =====
      // @ts-ignore
      window.cdc_adoQpoasnfa76pfcZLmcfl_Array = undefined;
      // @ts-ignore
      window.cdc_adoQpoasnfa76pfcZLmcfl_Promise = undefined;
      // @ts-ignore
      window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol = undefined;
    });
  } catch (err) {
    // 忽略脚本注入错误
  }
}

/**
 * 生成随机的浏览器配置
 */
export function generateBrowserConfig() {
  const ua = randomPick(USER_AGENTS);
  const screen = randomPick(SCREEN_SIZES);

  // 从 UA 提取 Chrome 版本
  const chromeVersion = ua.match(/Chrome\/(\d+)/)?.[1] || '131';

  return {
    userAgent: ua,
    viewport: {
      width: screen.width,
      height: screen.height,
      deviceScaleFactor: 1,
    },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: 24,
      pixelDepth: 24,
    },
    // Sec-CH-UA 头部（现代浏览器特性）
    extraHTTPHeaders: {
      'Sec-CH-UA': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24"`,
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"macOS"',
      'Sec-CH-UA-Platform-Version': '"10.15.7"',
      'Sec-CH-UA-Full-Version': `"${chromeVersion}.0.0.0"`,
      'Sec-CH-UA-Full-Version-List': `"Google Chrome";v="${chromeVersion}.0.0.0", "Chromium";v="${chromeVersion}.0.0.0", "Not_A Brand";v="24.0.0.0"`,
    },
  };
}

/**
 * 应用随机浏览器配置到 Context
 */
export async function applyRandomBrowserConfig(context: BrowserContext): Promise<void> {
  const config = generateBrowserConfig();

  // 设置额外的 HTTP 头部
  await context.setExtraHTTPHeaders(config.extraHTTPHeaders);
}

/**
 * 模拟人类行为模式
 */
export async function simulateHumanBehavior(page: Page): Promise<void> {
  // 随机鼠标移动
  const moveMouse = async () => {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y, { steps: randomNoise(10, 10) });
  };

  // 执行 2-3 次随机移动
  const moves = randomNoise(2, 2);
  for (let i = 0; i < moves; i++) {
    await moveMouse();
    await new Promise((resolve) => setTimeout(resolve, randomNoise(200, 300)));
  }
}
