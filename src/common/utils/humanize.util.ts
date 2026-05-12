import type { Page } from 'playwright-core';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export const randomSleep = (min: number, max: number): Promise<void> =>
  sleep(randomInt(min, max));

/**
 * Scroll page gradually to trigger lazy-loaded content.
 * Returns total scrolled height.
 */
export async function scrollPage(
  page: Page,
  opts: { steps?: number; stepDelayMs?: [number, number] } = {},
): Promise<number> {
  const steps = opts.steps ?? 1;
  const [minDelay, maxDelay] = opts.stepDelayMs ?? [400, 900];
  let total = 0;
  for (let i = 0; i < steps; i++) {
    total = await page.evaluate(() => {
      const h = window.innerHeight;
      window.scrollBy({ top: h * 0.8, behavior: 'smooth' });
      return document.documentElement.scrollTop;
    });
    await randomSleep(minDelay, maxDelay);
  }
  return total;
}

export async function scrollToBottom(
  page: Page,
  opts: { maxRounds?: number; stepDelayMs?: [number, number] } = {},
): Promise<void> {
  const maxRounds = opts.maxRounds ?? 30;
  const [minDelay, maxDelay] = opts.stepDelayMs ?? [600, 1400];
  let lastHeight = 0;
  for (let i = 0; i < maxRounds; i++) {
    const height = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    await randomSleep(minDelay, maxDelay);
    if (height === lastHeight) return;
    lastHeight = height;
  }
}
