import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { AppConfig } from '../../config/configuration';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 内存级幂等缓存：按 (target, payload) 哈希作为 key，TTL 内复用结果。
 * 主要用于防止 agent 因循环/重试反复打同一目标，被风控加速。
 * 容量超过 maxEntries 时按最近最少访问淘汰（朴素 Map 顺序模拟）。
 */
@Injectable()
export class ScrapeCacheService implements OnModuleInit {
  private readonly logger = new Logger(ScrapeCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private ttlMs = 5 * 60 * 1000;
  private maxEntries = 256;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cache = this.config.get<AppConfig['cache']>('cache');
    if (cache) {
      this.ttlMs = cache.ttlMs;
      this.maxEntries = cache.maxEntries;
    }
    this.logger.log(`scrape cache ttl=${this.ttlMs}ms cap=${this.maxEntries}`);
  }

  buildKey(target: string, payload: unknown): string {
    const norm = JSON.stringify(payload, Object.keys(payload as object).sort());
    const h = createHash('sha1').update(`${target}|${norm}`).digest('hex').slice(0, 16);
    return `${target}:${h}`;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // 触发 LRU 顺序：删后插
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  stats(): { size: number; max: number; ttlMs: number } {
    return { size: this.store.size, max: this.maxEntries, ttlMs: this.ttlMs };
  }
}
