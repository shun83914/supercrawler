import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Cookie } from 'playwright-core';
import type { AppConfig } from '../config/configuration';
import { BrowserService } from '../browser/browser.service';
import { PageFactoryService } from '../browser/page-factory.service';
import type { AuthPlatform } from './dto/login.dto';
import { LoginMetadataService, LoginMetadata } from './login-metadata.service';

export interface LoginStatus {
  accountId: string;
  platform: AuthPlatform;
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  checkedAt: string;
  // 扩展字段：用于区分不同失败场景
  reason?: 'NEVER_LOGGED_IN' | 'LOGIN_EXPIRED' | 'LOGGED_OUT' | 'PROFILE_DELETED' | 'CLEANED_UP';
  suggestion?: string;
  lastLoginAt?: string;
  expiredAt?: string;
  cached?: boolean;
}

interface PlatformProfile {
  home: string;
  cookieKeys: string[];
  loginWaitMs: number;
  probe: (
    context: import('playwright-core').BrowserContext,
    home: string,
  ) => Promise<{ userId?: string; nickname?: string } | null>;
}

const XHS_HOME = 'https://www.xiaohongshu.com';
const XHS_LOGIN_COOKIE_KEYS = ['web_session', 'webBuild', 'xsecappid'];

const DOUYIN_HOME = 'https://www.douyin.com';
const DOUYIN_LOGIN_COOKIE_KEYS = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'uid_tt',
  'passport_csrf_token',
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private metadataService: LoginMetadataService;

  constructor(
    private readonly browser: BrowserService,
    private readonly pages: PageFactoryService,
    private readonly config: ConfigService,
  ) {
    const profileDir = this.config.get<string>('profileDir') || './data/profiles';
    this.metadataService = new LoginMetadataService(profileDir);
  }

  /**
   * 打开 headed 浏览器等待扫码登录；出现关键 cookie 即判定成功。
   */
  async loginInteractive(
    accountId: string,
    proxy?: string,
    platform: AuthPlatform = 'xhs',
  ): Promise<LoginStatus> {
    const profile = this.profile(platform);
    
    // 关键修复 1: 先关闭已存在的浏览器 Context
    // 防止内存中残留旧的登录态
    if (this.browser.hasContext(accountId)) {
      this.logger.log(
        `[login ${platform}/${accountId}] 检测到已存在的浏览器 Context，正在关闭...`,
      );
      await this.browser.closeContext(accountId);
      this.logger.log(
        `[login ${platform}/${accountId}] 旧 Context 已关闭`,
      );
    }
    
    // 关键修复 2: 登录前验证并清理 profile 状态
    await this.validateAndCleanupProfile(accountId, platform);
    
    // 关键修复 3: 强制清除浏览器的 Cookie 和 Session 文件
    // 确保不会使用残留的登录信息
    await this.clearBrowserCredentials(accountId, platform);
    
    const lease = await this.pages.acquire(accountId, {
      headless: false,
      ...(proxy ? { proxy } : {}),
    });
    const { page, context, release } = lease;
    try {
      // 关键增强 1: 自动关闭 alert/confirm/prompt 弹窗
      page.on('dialog', async (dialog) => {
        this.logger.warn(
          `[login ${platform}/${accountId}] 检测到弹窗: ${dialog.type()} - ${dialog.message()}`,
        );
        
        // 根据弹窗类型采取不同处理方式
        try {
          if (dialog.type() === 'alert') {
            // alert 只有一个按钮，使用 accept()
            this.logger.warn(`[login ${platform}/${accountId}] 自动关闭 alert 弹窗`);
            await dialog.accept();
          } else if (dialog.type() === 'confirm') {
            // confirm 有两个按钮（确定/取消），使用 dismiss() 取消
            this.logger.warn(`[login ${platform}/${accountId}] 自动关闭 confirm 弹窗`);
            await dialog.dismiss();
          } else if (dialog.type() === 'prompt') {
            // prompt 有输入框，使用 dismiss() 取消
            this.logger.warn(`[login ${platform}/${accountId}] 自动关闭 prompt 弹窗`);
            await dialog.dismiss();
          } else if (dialog.type() === 'beforeunload') {
            // beforeunload 页面卸载确认，使用 dismiss() 取消
            this.logger.warn(`[login ${platform}/${accountId}] 自动关闭 beforeunload 弹窗`);
            await dialog.dismiss();
          } else {
            // 未知类型，默认使用 accept()
            this.logger.warn(`[login ${platform}/${accountId}] 自动关闭未知类型弹窗: ${dialog.type()}`);
            await dialog.accept();
          }
        } catch (err) {
          this.logger.error(
            `[login ${platform}/${accountId}] 关闭弹窗失败: ${(err as Error).message}`,
          );
        }
      });

      // 关键增强 2: 打开页面
      this.logger.log(
        `[login ${platform}/${accountId}] 正在打开 ${profile.home}...`,
      );
      
      await page.goto(profile.home, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000, // 30秒超时
      });

      // 关键增强 3: 等待页面完全加载（包括 JavaScript）
      this.logger.log(
        `[login ${platform}/${accountId}] 等待页面完全加载...`,
      );
      await page.waitForLoadState('networkidle').catch(() => {
        this.logger.warn(
          `[login ${platform}/${accountId}] networkidle 超时，继续执行`,
        );
      });

      // 关键增强 4: 等待登录表单元素出现（智能等待，最长 15 秒）
      this.logger.log(
        `[login ${platform}/${accountId}] 等待登录表单加载...`,
      );
      
      try {
        // 根据不同平台等待特定的登录元素
        const loginSelectors: Record<AuthPlatform, string> = {
          xhs: '.login-container, [class*="login"], qr-code', // 小红书登录容器
          douyin: '.login-panel, [class*="qrcode"], #captcha-verify-container', // 抖音登录面板
        };
        
        const selector = loginSelectors[platform];
        if (selector) {
          // 等待登录元素出现，最长 15 秒
          await page.waitForSelector(selector, { 
            timeout: 15000,
            state: 'visible',
          }).catch(() => {
            this.logger.warn(
              `[login ${platform}/${accountId}] 未检测到特定登录元素，使用固定等待`,
            );
          });
        }
      } catch (err) {
        this.logger.warn(
          `[login ${platform}/${accountId}] 等待登录元素超时: ${(err as Error).message}`,
        );
      }

      // 关键增强 5: 固定等待，确保登录表单完全渲染
      // 抖音登录框通常延迟 2-3 秒出现，小红书 1-2 秒
      const initialWait = platform === 'douyin' ? 5000 : 3000;
      this.logger.log(
        `[login ${platform}/${accountId}] 等待 ${initialWait}ms 让登录表单完全渲染...`,
      );
      await page.waitForTimeout(initialWait);

      // 关键增强 6: 截图调试（可选，帮助诊断登录表单是否加载）
      try {
        const debugScreenshot = `/tmp/login-debug-${platform}-${accountId}.png`;
        await page.screenshot({ path: debugScreenshot, fullPage: true });
        this.logger.log(
          `[login ${platform}/${accountId}] 调试截图已保存: ${debugScreenshot}`,
        );
      } catch {
        // 忽略截图错误
      }

      this.logger.log(
        `[login ${platform}/${accountId}] 请在弹出的浏览器中扫码登录，最长等待 ${profile.loginWaitMs}ms`,
      );
      
      const deadline = Date.now() + profile.loginWaitMs;
      let checkCount = 0;
      
      while (Date.now() < deadline) {
        checkCount++;
        
        // 检查是否有 session cookie
        if (await this.hasSessionCookie(context, profile)) {
          this.logger.log(
            `[login ${platform}/${accountId}] 检测到登录 Cookie (检查 ${checkCount} 次)`,
          );
          
          const status = await this.probeStatus(accountId, platform, context);
          if (status.loggedIn) {
            // 保存登录元数据
            await this.saveLoginMetadata(accountId, platform, status);
            this.logger.log(
              `[login ${platform}/${accountId}] 登录成功! userId: ${status.userId}, nickname: ${status.nickname}`,
            );
            return status;
          }
        }
        
        // 每 2 秒检查一次
        await page.waitForTimeout(2000);
      }
      
      this.logger.error(
        `[login ${platform}/${accountId}] 登录超时，已检查 ${checkCount} 次`,
      );
      throw new Error(`login timeout after ${profile.loginWaitMs}ms (checked ${checkCount} times)`);
    } finally {
      await release();
    }
  }

  /**
   * 清除浏览器的 Cookie 和 Session 文件
   * 确保登录时不会使用残留的登录信息
   * 
   * 适用场景：
   * 1. 首次登录
   * 2. 重新登录
   * 3. 登录过期后重新登录
   * 
   * 关键修复：直接删除整个 Default 目录，而不是清理单个文件
   * 这是最彻底的方式，确保没有任何残留的登录态
   */
  private async clearBrowserCredentials(
    accountId: string,
    platform: AuthPlatform,
  ): Promise<void> {
    const profileDir = this.config.get<string>('profileDir') || './data/profiles';
    const accountDir = path.join(profileDir, accountId);
    const defaultDir = path.join(accountDir, 'Default');
    const metadataFile = path.join(accountDir, 'login-metadata.json');

    // 关键修复 1：删除整个 Default 目录
    // 这是最彻底的方式，确保清除所有登录态
    if (fs.existsSync(defaultDir)) {
      try {
        this.logger.log(
          `[login ${platform}/${accountId}] 删除整个 Default 目录（彻底清除登录态）...`,
        );
        
        // 递归删除整个目录
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
        
        this.logger.log(
          `[login ${platform}/${accountId}] Default 目录已删除，浏览器将创建全新的 profile`,
        );
      } catch (err) {
        this.logger.error(
          `[login ${platform}/${accountId}] 删除 Default 目录失败: ${(err as Error).message}`,
        );
        
        // 如果删除失败，尝试清理关键文件
        this.logger.warn(
          `[login ${platform}/${accountId}] 尝试清理关键文件作为备用方案...`,
        );
        await this.cleanupIndividualFiles(accountDir, platform);
      }
    } else {
      this.logger.log(
        `[login ${platform}/${accountId}] Default 目录不存在（首次登录），将创建全新的 profile`,
      );
    }

    // 关键修复 2：删除登录元数据文件
    // 防止 checkStatus 使用缓存的登录状态，强制重新验证
    if (fs.existsSync(metadataFile)) {
      try {
        this.logger.log(
          `[login ${platform}/${accountId}] 删除登录元数据文件（清除缓存状态）...`,
        );
        
        await fs.promises.unlink(metadataFile);
        
        this.logger.log(
          `[login ${platform}/${accountId}] 元数据文件已删除，下次 checkStatus 将重新验证`,
        );
      } catch (err) {
        this.logger.warn(
          `[login ${platform}/${accountId}] 删除元数据文件失败: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * 备用方案：清理单个文件（当删除目录失败时使用）
   */
  private async cleanupIndividualFiles(
    accountDir: string,
    platform: AuthPlatform,
  ): Promise<void> {
    const defaultDir = path.join(accountDir, 'Default');
    const accountId = path.basename(accountDir); // 从目录路径提取 accountId
    
    // 确保目录存在
    if (!fs.existsSync(defaultDir)) {
      await fs.promises.mkdir(defaultDir, { recursive: true });
      return;
    }

    // 需要清理的文件列表（扩展版）
    const filesToClean = [
      // Cookie 文件
      'Cookies',
      'Cookies-journal',
      
      // 登录数据
      'Login Data',
      'Login Data For Account',
      'Login Data For Account-journal',
      
      // Session 存储
      'Session Storage',
      'Session Storage-journal',
      
      // Local Storage（可能包含登录态）
      'Local Storage',
      'Local Storage-journal',
      
      // IndexedDB（可能包含登录态）
      'IndexedDB',
      
      // Service Workers
      'Service Worker',
      
      // Network（HTTP 缓存，可能包含认证信息）
      'Network',
      'Network Cache',
      
      // 其他可能包含登录态的文件
      'Network Persistent State',
      'QuotaManager',
      'QuotaManager-journal',
      'Web Data',
      'Web Data-journal',
      'History',
      'History-journal',
      'Top Sites',
      'Top Sites-journal',
      'Favicons',
      'Favicons-journal',
    ];

    let cleanedCount = 0;
    
    for (const file of filesToClean) {
      const filePath = path.join(defaultDir, file);
      
      try {
        if (fs.existsSync(filePath)) {
          const stats = await fs.promises.stat(filePath);
          
          if (stats.isDirectory()) {
            // 删除目录及其内容
            await fs.promises.rm(filePath, { recursive: true, force: true });
            this.logger.log(
              `[login ${platform}/${accountId}] 清理目录: ${file}`,
            );
          } else {
            // 删除文件
            await fs.promises.unlink(filePath);
            this.logger.log(
              `[login ${platform}/${accountId}] 清理文件: ${file}`,
            );
          }
          
          cleanedCount++;
        }
      } catch (err) {
        this.logger.warn(
          `[login ${platform}/${accountId}] 清理 ${file} 失败: ${(err as Error).message}`,
        );
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(
        `[login ${platform}/${accountId}] 备用方案：已清理 ${cleanedCount} 个文件/目录`,
      );
    }
  }

  /**
   * 验证并清理 profile 状态（防止多平台登录冲突）
   * 
   * 问题场景：
   * 1. 先登录抖音，profile 中写入抖音 Cookie
   * 2. 再登录小红书，但 profile 中仍有抖音 Cookie
   * 3. 导致平台检测混乱或 Cookie 冲突
   * 
   * 解决方案：
   * 1. 检查 profile 目录状态
   * 2. 清理残留的锁文件
   * 3. 验证元数据一致性
   */
  private async validateAndCleanupProfile(
    accountId: string,
    platform: AuthPlatform,
  ): Promise<void> {
    const profileDir = this.config.get<string>('profileDir') || './data/profiles';
    const accountDir = path.join(profileDir, accountId);

    // 1. 检查 profile 目录是否存在
    if (!fs.existsSync(accountDir)) {
      this.logger.log(`Profile directory does not exist, will create: ${accountDir}`);
      await fs.promises.mkdir(accountDir, { recursive: true });
      return;
    }

    // 2. 清理残留的锁文件
    const lockFile = path.join(accountDir, 'SingletonLock');
    const lockSocket = path.join(accountDir, 'SingletonSocket');
    
    try {
      if (fs.existsSync(lockFile)) {
        await fs.promises.unlink(lockFile);
        this.logger.log(`Cleaned stale lock file before login: ${lockFile}`);
      }
      if (fs.existsSync(lockSocket)) {
        await fs.promises.unlink(lockSocket);
        this.logger.log(`Cleaned stale socket before login: ${lockSocket}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to cleanup lock files: ${(err as Error).message}`);
    }

    // 3. 检查元数据一致性
    const metadataService = this.metadataService;
    const currentMetadata = await metadataService.read(accountId, platform);
    
    if (currentMetadata) {
      this.logger.log(
        `Existing ${platform} metadata found (loginAt: ${currentMetadata.loginAt}, status: ${currentMetadata.status})`,
      );
      
      // 如果之前标记为 expired，清理旧数据
      if (currentMetadata.status === 'expired') {
        this.logger.log(`Previous ${platform} session expired, cleaning up...`);
        await this.cleanupExpiredData(accountId, platform, true);
      }
    } else {
      this.logger.log(`No existing ${platform} metadata, fresh login`);
    }
  }

  /**
   * 保存登录元数据
   */
  private async saveLoginMetadata(
    accountId: string,
    platform: AuthPlatform,
    status: LoginStatus,
  ): Promise<void> {
    const now = new Date();

    await this.metadataService.save(accountId, {
      platform,
      loginAt: now.toISOString(),
      lastVerifiedAt: now.toISOString(),
      userId: status.userId,
      nickname: status.nickname,
      status: 'valid',
    });

    this.logger.log(`Saved login metadata for ${accountId}/${platform}`);
  }

  /**
   * 无头探测登录态（不触发扫码流程）。
   * 支持元数据缓存和过期检测。
   */
  async checkStatus(
    accountId: string,
    platform: AuthPlatform = 'xhs',
  ): Promise<LoginStatus> {
    const profileDir = this.config.get<string>('profileDir') || './data/profiles';
    const profilePath = path.join(profileDir, accountId);

    // 1. 检查 profiles 目录是否存在
    if (!fs.existsSync(profilePath)) {
      return {
        accountId,
        platform,
        loggedIn: false,
        reason: 'PROFILE_DELETED',
        suggestion: '登录数据已被删除，请重新扫码登录',
        checkedAt: new Date().toISOString(),
      };
    }

    // 2. 读取元数据（快速判断，不启动浏览器）
    const metadata = await this.metadataService.read(accountId, platform);

    if (!metadata) {
      return {
        accountId,
        platform,
        loggedIn: false,
        reason: 'NEVER_LOGGED_IN',
        suggestion: '请调用 POST /api/auth/login 进行扫码登录',
        checkedAt: new Date().toISOString(),
      };
    }

    // 3. 如果已确认过期，检查是否需要清理
    if (metadata.status === 'expired') {
      if (this.metadataService.isExpiredForSevenDays(metadata)) {
        // 过期超过 7 天，自动清理
        await this.cleanupExpiredData(accountId, platform);
        return {
          accountId,
          platform,
          loggedIn: false,
          reason: 'CLEANED_UP',
          suggestion: '过期登录数据已清理，请重新扫码登录',
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        accountId,
        platform,
        loggedIn: false,
        reason: 'LOGIN_EXPIRED',
        lastLoginAt: metadata.loginAt,
        expiredAt: metadata.lastFailedAt,
        suggestion: `登录已过期（${metadata.loginAt.slice(0, 10)} 登录），请重新扫码登录`,
        checkedAt: new Date().toISOString(),
      };
    }

    // 4. 如果距上次验证 < 7天，返回缓存结果
    if (this.metadataService.isWithinCacheTime(metadata)) {
      return {
        accountId,
        platform,
        loggedIn: true,
        userId: metadata.userId,
        nickname: metadata.nickname,
        cached: true,
        checkedAt: new Date().toISOString(),
      };
    }

    // 5. 实际探测（启动浏览器）
    const lease = await this.pages.acquire(accountId, { headless: true });
    try {
      const status = await this.probeStatus(accountId, platform, lease.context);

      // 6. 更新元数据
      if (status.loggedIn) {
        await this.metadataService.update(accountId, platform, {
          status: 'valid',
          lastVerifiedAt: new Date().toISOString(),
          userId: status.userId || metadata.userId,
          nickname: status.nickname || metadata.nickname,
        });
      } else {
        // 探测失败 = 登录过期
        await this.metadataService.update(accountId, platform, {
          status: 'expired',
          lastFailedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
        });

        status.reason = 'LOGIN_EXPIRED';
        status.suggestion = '登录已过期，请重新扫码登录';
        status.lastLoginAt = metadata.loginAt;
        status.expiredAt = status.checkedAt;
      }

      return status;
    } finally {
      await lease.release();
    }
  }

  async logout(accountId: string): Promise<void> {
    await this.browser.closeContext(accountId);
    this.logger.log(`[logout ${accountId}] context closed, profile preserved`);
  }

  /**
   * 清理过期平台的登录数据
   * 
   * @param accountId 账号 ID
   * @param platform 平台
   * @param force 是否强制清理（忽略时间限制）
   */
  async cleanupExpiredData(
    accountId: string,
    platform: AuthPlatform,
    force = false,
  ): Promise<{ cleaned: boolean; reason?: string }> {
    const metadata = await this.metadataService.read(accountId, platform);

    if (!metadata) {
      return { cleaned: false, reason: 'No metadata found' };
    }

    if (metadata.status !== 'expired' && !force) {
      return { cleaned: false, reason: 'Not expired' };
    }

    // 检查是否过期超过 7 天
    if (!this.metadataService.isExpiredForSevenDays(metadata) && !force) {
      return { cleaned: false, reason: 'Not old enough to cleanup' };
    }

    // 清理 cookies 和登录数据
    const profileDir = this.config.get<string>('profileDir') || './data/profiles';
    const profilePath = path.join(profileDir, accountId, 'Default');

    try {
      const filesToClean = [
        'Cookies',
        'Cookies-journal',
        'Login Data',
        'Login Data For Account',
      ];

      for (const file of filesToClean) {
        const filePath = path.join(profilePath, file);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          this.logger.log(`Cleaned up ${file}`);
        }
      }

      // 删除元数据文件
      await this.metadataService.delete(accountId);

      this.logger.log(`Cleaned up expired login data for ${accountId}/${platform}`);
      return { cleaned: true };
    } catch (err) {
      this.logger.error(`Cleanup failed: ${err.message}`);
      return { cleaned: false, reason: err.message };
    }
  }

  private profile(platform: AuthPlatform): PlatformProfile {
    if (platform === 'douyin') {
      const dy = this.config.get<AppConfig['douyin']>('douyin');
      return {
        home: DOUYIN_HOME,
        cookieKeys: DOUYIN_LOGIN_COOKIE_KEYS,
        loginWaitMs: dy?.loginWaitMs ?? 300_000,
        probe: this.probeDouyin.bind(this),
      };
    }
    const xhs = this.config.get<AppConfig['xhs']>('xhs');
    return {
      home: XHS_HOME,
      cookieKeys: XHS_LOGIN_COOKIE_KEYS,
      loginWaitMs: xhs?.loginWaitMs ?? 300_000,
      probe: this.probeXhs.bind(this),
    };
  }

  private async hasSessionCookie(
    context: import('playwright-core').BrowserContext,
    profile: PlatformProfile,
  ): Promise<boolean> {
    const cookies = await context.cookies([profile.home]);
    return cookies.some((c: Cookie) => profile.cookieKeys.includes(c.name));
  }

  private async probeStatus(
    accountId: string,
    platform: AuthPlatform,
    context: import('playwright-core').BrowserContext,
  ): Promise<LoginStatus> {
    const profile = this.profile(platform);
    const loggedIn = await this.hasSessionCookie(context, profile);
    const base: LoginStatus = {
      accountId,
      platform,
      loggedIn,
      checkedAt: new Date().toISOString(),
    };
    if (!loggedIn) return base;
    try {
      const info = await profile.probe(context, profile.home);
      if (info) {
        base.userId = info.userId;
        base.nickname = info.nickname;
      }
    } catch {
      // swallow, still return loggedIn=true
    }
    return base;
  }

  private async probeXhs(
    context: import('playwright-core').BrowserContext,
    home: string,
  ): Promise<{ userId?: string; nickname?: string } | null> {
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    if (!page.url().startsWith(home)) {
      await page.goto(home, { waitUntil: 'domcontentloaded' });
    }
    return page.evaluate(() => {
      const w = window as unknown as {
        __INITIAL_STATE__?: Record<string, unknown>;
      };
      const s = w.__INITIAL_STATE__;
      if (!s) return null;
      const user = (s.user ?? s.userStore ?? {}) as Record<string, unknown>;
      const info = (user.info ?? user.userInfo ?? user) as Record<
        string,
        unknown
      >;
      return {
        userId:
          (info?.userId as string | undefined) ??
          (info?.user_id as string | undefined),
        nickname:
          (info?.nickname as string | undefined) ??
          (info?.name as string | undefined),
      };
    });
  }

  private async probeDouyin(
    context: import('playwright-core').BrowserContext,
    home: string,
  ): Promise<{ userId?: string; nickname?: string } | null> {
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    if (!page.url().startsWith(home)) {
      await page.goto(home, { waitUntil: 'domcontentloaded' });
    }
    return page.evaluate(() => {
      type Bag = Record<string, unknown>;
      const w = window as unknown as {
        _SSR_DATA?: Bag;
        _ROUTER_DATA?: Bag;
      };
      const sources: Bag[] = [];
      if (w._SSR_DATA) sources.push(w._SSR_DATA);
      if (w._ROUTER_DATA) sources.push(w._ROUTER_DATA);
      const visit = (
        node: unknown,
        depth: number,
      ): { userId?: string; nickname?: string } | null => {
        if (!node || depth > 6 || typeof node !== 'object') return null;
        const obj = node as Bag;
        const uid =
          (obj.uid as string | undefined) ??
          (obj.userId as string | undefined) ??
          (obj.user_id as string | undefined) ??
          (obj.sec_uid as string | undefined) ??
          (obj.secUid as string | undefined);
        const nick =
          (obj.nickname as string | undefined) ??
          (obj.name as string | undefined) ??
          (obj.screen_name as string | undefined);
        if (uid || nick) return { userId: uid, nickname: nick };
        for (const k of Object.keys(obj)) {
          const child = visit(obj[k], depth + 1);
          if (child) return child;
        }
        return null;
      };
      for (const src of sources) {
        const found = visit(src, 0);
        if (found) return found;
      }
      return null;
    });
  }
}
