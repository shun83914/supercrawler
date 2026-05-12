import { Injectable } from '@nestjs/common';
import { BrowserService } from './browser/browser.service';
import { ScrapeCacheService } from './common/cache/scrape-cache.service';
import { XhsService } from './xhs/xhs.service';

export interface HealthReport {
  status: 'ok';
  name: string;
  version: string;
  time: string;
  uptimeSec: number;
  accounts: {
    onlineContexts: Array<{ accountId: string; activePages: number; headless: boolean }>;
    profilesOnDisk: string[];
  };
  semaphore: { running: number; queued: number; max: number };
  cache: { size: number; max: number; ttlMs: number };
}

@Injectable()
export class AppService {
  constructor(
    private readonly browser: BrowserService,
    private readonly cache: ScrapeCacheService,
    private readonly xhs: XhsService,
  ) {}

  async health(): Promise<HealthReport> {
    const profilesOnDisk = await this.browser.listProfiles();
    return {
      status: 'ok',
      name: 'supercrawler',
      version: '0.1.0',
      time: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      accounts: {
        onlineContexts: this.browser.listContexts().map(({ accountId, activePages, headless }) => ({
          accountId,
          activePages,
          headless,
        })),
        profilesOnDisk,
      },
      semaphore: this.xhs.semaphoreStats(),
      cache: this.cache.stats(),
    };
  }
}
