import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cookie } from 'playwright-core';
import type { AppConfig } from '../config/configuration';
import { BrowserService } from '../browser/browser.service';
import { PageFactoryService } from '../browser/page-factory.service';
import type { AuthPlatform } from './dto/login.dto';

export interface LoginStatus {
  accountId: string;
  platform: AuthPlatform;
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  checkedAt: string;
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

  constructor(
    private readonly browser: BrowserService,
    private readonly pages: PageFactoryService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 打开 headed 浏览器等待扫码登录；出现关键 cookie 即判定成功。
   */
  async loginInteractive(
    accountId: string,
    proxy?: string,
    platform: AuthPlatform = 'xhs',
  ): Promise<LoginStatus> {
    const profile = this.profile(platform);
    const lease = await this.pages.acquire(accountId, {
      headless: false,
      ...(proxy ? { proxy } : {}),
    });
    const { page, context, release } = lease;
    try {
      await page.goto(profile.home, { waitUntil: 'domcontentloaded' });
      this.logger.log(
        `[login ${platform}/${accountId}] 请在弹出的浏览器中扫码登录，最长等待 ${profile.loginWaitMs}ms`,
      );
      const deadline = Date.now() + profile.loginWaitMs;
      while (Date.now() < deadline) {
        if (await this.hasSessionCookie(context, profile)) {
          const status = await this.probeStatus(accountId, platform, context);
          if (status.loggedIn) return status;
        }
        await page.waitForTimeout(2000);
      }
      throw new Error(`login timeout after ${profile.loginWaitMs}ms`);
    } finally {
      await release();
    }
  }

  /**
   * 无头探测登录态（不触发扫码流程）。
   */
  async checkStatus(
    accountId: string,
    platform: AuthPlatform = 'xhs',
  ): Promise<LoginStatus> {
    const lease = await this.pages.acquire(accountId, { headless: true });
    try {
      return await this.probeStatus(accountId, platform, lease.context);
    } finally {
      await lease.release();
    }
  }

  async logout(accountId: string): Promise<void> {
    await this.browser.closeContext(accountId);
    this.logger.log(`[logout ${accountId}] context closed, profile preserved`);
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
