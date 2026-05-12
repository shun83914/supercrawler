import type { Page } from 'playwright-core';

export interface ScrapeContext {
  accountId: string;
}

export interface IScrapeStrategy<TIn, TOut> {
  readonly name: string;
  run(page: Page, input: TIn, ctx: ScrapeContext): Promise<TOut>;
}
