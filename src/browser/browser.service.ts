import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { AppConfig } from '../config/configuration';
import type { LaunchOverride } from './interfaces/browser-options.interface';

/**
 * 动态加载 CloakBrowser (ESM-only)，兼容 NestJS 的 CommonJS 运行时。
 */
async function loadCloak(): Promise<typeof import('cloakbrowser')> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (await new Function('return import("cloakbrowser")')()) as typeof import('cloakbrowser');
}

interface ContextEntry {
  accountId: string;
  userDataDir: string;
  context: BrowserContext;
  activePages: number;
  headless: boolean;
}

/**
 * 管理 CloakBrowser PersistentContext 生命周期（按 accountId 复用）。
 */
@Injectable()
export class BrowserService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BrowserService.name);
  private readonly contexts = new Map<string, ContextEntry>();
  private readonly locks = new Map<string, Promise<ContextEntry>>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const base = this.config.get<string>('profileDir') || './data/profiles';
    await fs.promises.mkdir(path.resolve(base), { recursive: true });
    this.logger.log(`profile base dir ready: ${path.resolve(base)}`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const [id, entry] of this.contexts.entries()) {
      try {
        await entry.context.close();
        this.logger.log(`closed context: ${id}`);
      } catch (err) {
        this.logger.warn(`close context ${id} failed: ${(err as Error).message}`);
      }
    }
    this.contexts.clear();
  }

  /**
   * 获取（或惰性创建）指定账号的持久化 context。
   * 多次请求同 accountId 复用同一 context。
   */
  async acquireContext(
    accountId = 'default',
    override: LaunchOverride = {},
  ): Promise<BrowserContext> {
    const existing = this.contexts.get(accountId);
    if (existing) {
      existing.activePages += 1;
      return existing.context;
    }
    const pending = this.locks.get(accountId);
    if (pending) {
      const entry = await pending;
      entry.activePages += 1;
      return entry.context;
    }
    const task = this.createContext(accountId, override).finally(() => {
      this.locks.delete(accountId);
    });
    this.locks.set(accountId, task);
    const entry = await task;
    entry.activePages += 1;
    return entry.context;
  }

  /**
   * 释放 Page 计数（不会真正关闭 context，保持复用）。
   */
  releaseContext(accountId = 'default'): void {
    const entry = this.contexts.get(accountId);
    if (entry && entry.activePages > 0) entry.activePages -= 1;
  }

  /**
   * 显式关闭某个账号的 context（例如 logout）。
   */
  async closeContext(accountId: string): Promise<void> {
    const entry = this.contexts.get(accountId);
    if (!entry) return;
    try {
      await entry.context.close();
    } finally {
      this.contexts.delete(accountId);
    }
  }

  hasContext(accountId: string): boolean {
    return this.contexts.has(accountId);
  }

  /** 列出当前在线的所有 context 状态。 */
  listContexts(): Array<{ accountId: string; activePages: number; headless: boolean; userDataDir: string }> {
    return Array.from(this.contexts.values()).map((e) => ({
      accountId: e.accountId,
      activePages: e.activePages,
      headless: e.headless,
      userDataDir: e.userDataDir,
    }));
  }

  /** 扫描 profileDir 下已存在的 profile 子目录（agent 判断账号是否需登录用）。 */
  async listProfiles(): Promise<string[]> {
    const base = this.config.get<string>('profileDir') || './data/profiles';
    try {
      const entries = await fs.promises.readdir(path.resolve(base), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  profileDirOf(accountId: string): string {
    const base = this.config.get<string>('profileDir') || './data/profiles';
    return path.resolve(base, accountId);
  }

  private async createContext(
    accountId: string,
    override: LaunchOverride,
  ): Promise<ContextEntry> {
    const cloak = this.config.get<AppConfig['cloak']>('cloak');
    const userDataDir = this.profileDirOf(accountId);
    await fs.promises.mkdir(userDataDir, { recursive: true });

    const headless = override.headless ?? cloak?.headless ?? false;
    const humanize = override.humanize ?? cloak?.humanize ?? true;
    const proxy = override.proxy ?? cloak?.proxy;
    const timezone = override.timezone ?? cloak?.timezone ?? 'Asia/Shanghai';
    const locale = override.locale ?? cloak?.locale ?? 'zh-CN';

    this.logger.log(
      `launching persistent context accountId=${accountId} headless=${headless} humanize=${humanize} proxy=${proxy ?? 'none'}`,
    );

    const { launchPersistentContext } = await loadCloak();
    const context = await launchPersistentContext({
      userDataDir,
      headless,
      humanize,
      timezone,
      locale,
      ...(proxy ? { proxy } : {}),
      viewport: { width: 1440, height: 900 },
    });

    context.on('close', () => {
      this.contexts.delete(accountId);
      this.logger.warn(`context closed (external): ${accountId}`);
    });

    const entry: ContextEntry = {
      accountId,
      userDataDir,
      context,
      activePages: 0,
      headless,
    };
    this.contexts.set(accountId, entry);
    return entry;
  }
}
