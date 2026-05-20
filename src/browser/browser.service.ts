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
   * 
   * 支持平台隔离：通过 override.platform 参数区分不同平台
   */
  async acquireContext(
    accountId = 'default',
    override: LaunchOverride = {},
  ): Promise<BrowserContext> {
    // 使用 platform 作为 context key 的一部分，实现平台隔离
    const contextKey = override.platform 
      ? `${accountId}-${override.platform}` 
      : accountId;
    
    const existing = this.contexts.get(contextKey);
    if (existing) {
      existing.activePages += 1;
      return existing.context;
    }
    const pending = this.locks.get(contextKey);
    if (pending) {
      const entry = await pending;
      entry.activePages += 1;
      return entry.context;
    }
    const task = this.createContext(accountId, override, contextKey).finally(() => {
      this.locks.delete(contextKey);
    });
    this.locks.set(contextKey, task);
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
    contextKey: string, // 新增：context 的唯一键
  ): Promise<ContextEntry> {
    const cloak = this.config.get<AppConfig['cloak']>('cloak');
    // 使用 platform 隔离 userDataDir，避免不同平台的登录态冲突
    const platform = override.platform;
    const userDataDir = platform 
      ? this.profileDirOf(`${accountId}_${platform}`)
      : this.profileDirOf(accountId);
    await fs.promises.mkdir(userDataDir, { recursive: true });

    // 关键修复：在创建 context 前清理残留的锁文件
    // 防止容器异常退出或多次重启导致的锁文件冲突
    await this.cleanupLockFiles(userDataDir);

    const headless = override.headless ?? cloak?.headless ?? false;
    const humanize = override.humanize ?? cloak?.humanize ?? true;
    const proxy = override.proxy ?? cloak?.proxy;
    const timezone = override.timezone ?? cloak?.timezone ?? 'Asia/Shanghai';
    const locale = override.locale ?? cloak?.locale ?? 'zh-CN';

    this.logger.log(
      `launching persistent context contextKey=${contextKey} accountId=${accountId} platform=${platform || 'none'} headless=${headless} humanize=${humanize} proxy=${proxy ?? 'none'}`,
    );
    this.logger.log(
      `[DEBUG] userDataDir=${userDataDir} (profile storage path)`,
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
      this.contexts.delete(contextKey);
      this.logger.warn(`context closed (external): ${contextKey}`);
    });

    const entry: ContextEntry = {
      accountId: contextKey,
      userDataDir,
      context,
      activePages: 0,
      headless,
    };
    this.contexts.set(accountId, entry);
    return entry;
  }

  /**
   * 清理浏览器锁文件（防止异常退出后无法启动）
   */
  private async cleanupLockFiles(userDataDir: string): Promise<void> {
    const lockFile = path.join(userDataDir, 'SingletonLock');
    const lockSocket = path.join(userDataDir, 'SingletonSocket');
    
    let cleaned = 0;
    
    try {
      if (await fs.promises.access(lockFile).then(() => true).catch(() => false)) {
        await fs.promises.unlink(lockFile);
        cleaned++;
        this.logger.debug(`Removed stale lock file: ${lockFile}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to remove lock file ${lockFile}: ${(err as Error).message}`);
    }
    
    try {
      if (await fs.promises.access(lockSocket).then(() => true).catch(() => false)) {
        await fs.promises.unlink(lockSocket);
        cleaned++;
        this.logger.debug(`Removed stale socket: ${lockSocket}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to remove socket ${lockSocket}: ${(err as Error).message}`);
    }
    
    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} stale lock file(s) for ${path.basename(userDataDir)}`);
    }
  }
}
