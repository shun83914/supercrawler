import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrowserContext, Page } from 'playwright-core';
import type { AppConfig } from '../config/configuration';
import { BrowserService } from './browser.service';
import type { LaunchOverride } from './interfaces/browser-options.interface';

export interface PageLease {
  page: Page;
  context: BrowserContext;
  release: () => Promise<void>;
}

/**
 * 从 BrowserService 借一个 Page，并统一封装释放逻辑。
 */
@Injectable()
export class PageFactoryService {
  constructor(
    private readonly browser: BrowserService,
    private readonly config: ConfigService,
  ) {}

  async acquire(accountId = 'default', override: LaunchOverride = {}): Promise<PageLease> {
    const context = await this.browser.acquireContext(accountId, override);
    const page = await context.newPage();
    const xhs = this.config.get<AppConfig['xhs']>('xhs');
    if (xhs) {
      page.setDefaultNavigationTimeout(xhs.navigationTimeoutMs);
      page.setDefaultTimeout(xhs.navigationTimeoutMs);
    }
    const release = async () => {
      try {
        if (!page.isClosed()) await page.close();
      } finally {
        this.browser.releaseContext(accountId);
      }
    };
    return { page, context, release };
  }
}
