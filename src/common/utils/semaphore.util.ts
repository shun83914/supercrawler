/**
 * 轻量异步信号量：限制同时运行的异步任务数。
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1');
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // 保持 running 计数不变（直接转交给下一个任务）
      next();
    } else {
      this.running -= 1;
    }
  }

  /** 返回当前运行中 / 排队中任务数，用于健康上报。 */
  stats(): { running: number; queued: number; max: number } {
    return { running: this.running, queued: this.queue.length, max: this.max };
  }
}
