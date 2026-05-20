import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { NoteEntity } from '../entities/note.entity';
import { parseNoteFromState } from '../parsers/note.parser';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface NoteDetailInput {
  noteId: string;
}

const NOTE_API_PATTERN =
  /(api\/sns\/(web|h5)\/v\d+\/(feed|note(_info)?)|note_card|noteDetail)/i;

@Injectable()
export class NoteDetailStrategy implements IScrapeStrategy<NoteDetailInput, NoteEntity> {
  readonly name = 'note-detail';
  private readonly logger = new Logger(NoteDetailStrategy.name);

  async run(page: Page, input: NoteDetailInput, _ctx: ScrapeContext): Promise<NoteEntity> {
    const url = `https://www.xiaohongshu.com/explore/${encodeURIComponent(input.noteId)}`;

    this.logger.log(`[${input.noteId}] 开始抓取笔记详情，采用搜索页点击方式...`);

    // 策略：通过搜索页点击笔记卡片来获取详情，避免直接访问详情页触发风控
    // 使用 noteId 作为搜索关键词，这样可以精确定位到目标笔记
    
    // 设置 XHR 拦截器（在搜索和点击过程中拦截笔记详情 API）
    const xhrRawByNoteId = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      if (!NOTE_API_PATTERN.test(u)) return;
      void resp
        .json()
        .then((json) => {
          indexNotePayload(json, xhrRawByNoteId);
          // h5/v1/note_info 带明确 id 参数，补一下
          if (xhrRawByNoteId.size === 0 && json && typeof json === 'object') {
            const data = (json as AnyObj).data;
            if (data && typeof data === 'object') {
              const d = data as AnyObj;
              const idGuess = asString(d.note_id) ?? asString(d.id) ?? input.noteId;
              if (idGuess && (d.title || d.desc || d.interact_info)) xhrRawByNoteId.set(idGuess, d);
            }
          }
        })
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    try {
      // 步骤 1: 访问首页
      this.logger.log(`[${input.noteId}] 步骤 1: 访问小红书首页...`);
      await page.goto('https://www.xiaohongshu.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(2000, 3000);

      // 检测登录状态：检查是否出现二维码弹窗
      const needsLoginAfterHome = await this.checkLoginStatus(page, input.noteId);
      if (needsLoginAfterHome) {
        this.logger.warn(`[${input.noteId}] ⚠️ 检测到二维码弹窗，等待用户扫码登录...`);
        await this.waitForLoginComplete(page, input.noteId);
      }

      // 步骤 2: 使用 noteId 搜索目标笔记
      this.logger.log(`[${input.noteId}] 步骤 2: 搜索目标笔记...`);
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(input.noteId)}&source=web_explore_feed&sort=general`;
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(3000, 5000);

      // 再次检测登录状态（搜索后可能触发登录验证）
      const needsLoginAfterSearch = await this.checkLoginStatus(page, input.noteId);
      if (needsLoginAfterSearch) {
        this.logger.warn(`[${input.noteId}] ⚠️ 搜索后触发登录验证，等待用户扫码...`);
        await this.waitForLoginComplete(page, input.noteId);
      }

      // 步骤 3: 在搜索结果中查找并点击目标笔记
      this.logger.log(`[${input.noteId}] 步骤 3: 查找并点击目标笔记卡片...`);
      
      // 尝试多种选择器来定位笔记卡片
      const noteCardSelectors = [
        '.note-item',
        '.search-result-item',
        '[class*="note-item"]',
        '[class*="search-result"]',
        'a[href*="explore"]',
      ];
      
      let clicked = false;
      for (const selector of noteCardSelectors) {
        try {
          const cards = await page.$$(selector);
          this.logger.log(`[${input.noteId}] 找到 ${cards.length} 个卡片 (选择器: ${selector})`);
          
          for (const card of cards) {
            const href = await card.getAttribute('href');
            if (href && href.includes(input.noteId)) {
              this.logger.log(`[${input.noteId}] 找到目标笔记卡片，准备点击...`);
              
              // 模拟人类移动鼠标到卡片
              const box = await card.boundingBox();
              if (box) {
                await page.mouse.move(
                  box.x + box.width / 2, 
                  box.y + box.height / 2,
                  { steps: 10 } // 平滑移动
                );
                await randomSleep(500, 1000);
              }
              
              // 点击卡片
              await card.click();
              clicked = true;
              this.logger.log(`[${input.noteId}] ✅ 已点击笔记卡片`);
              break;
            }
          }
          
          if (clicked) break;
        } catch (err) {
          this.logger.debug(`[${input.noteId}] 选择器 ${selector} 失败: ${(err as Error).message}`);
        }
      }
      
      if (!clicked) {
        this.logger.warn(`[${input.noteId}] 未找到目标笔记卡片，尝试直接访问详情页...`);
        // 降级方案：直接访问详情页
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
      }

      // 步骤 4: 等待详情页加载
      this.logger.log(`[${input.noteId}] 步骤 4: 等待详情页加载...`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(3000, 5000);

      // 点击后再次检测登录状态
      const needsLoginAfterClick = await this.checkLoginStatus(page, input.noteId);
      if (needsLoginAfterClick) {
        this.logger.warn(`[${input.noteId}] ⚠️ 点击后触发登录验证，等待用户扫码...`);
        await this.waitForLoginComplete(page, input.noteId);
      }

      // 步骤 5: 模拟人类阅读行为
      this.logger.log(`[${input.noteId}] 步骤 5: 模拟人类滚动阅读...`);
      await scrollPage(page, { steps: 3, stepDelayMs: [1000, 2000] });
      await randomSleep(1500, 2500);

      // 获取数据：XHR 拦截 > __INITIAL_STATE__ > DOM 提取
      // 1) XHR 拦截路径。
      const raw = xhrRawByNoteId.get(input.noteId);
      if (raw) {
        this.logger.log(`[${input.noteId}] ✅ 通过 XHR 拦截获取到数据`);
        const fromXhr = noteEntityFromRaw(raw, input.noteId, url);
        if (fromXhr) return fromXhr;
      }

      // 2) __INITIAL_STATE__ 路径。
      const stateJson = await page.evaluate(() => {
        const w = window as unknown as { __INITIAL_STATE__?: unknown };
        const root = w.__INITIAL_STATE__ ?? null;
        if (root === null) return null;
        const seen = new WeakSet<object>();
        try {
          return JSON.stringify(root, (_k, v) => {
            if (typeof v === 'object' && v !== null) {
              if (seen.has(v as object)) return undefined;
              seen.add(v as object);
            }
            if (typeof v === 'function') return undefined;
            return v;
          });
        } catch {
          return null;
        }
      });
      const state: unknown = stateJson ? JSON.parse(stateJson) : null;
      const parsed = parseNoteFromState(state, input.noteId, url);
      if (parsed) {
        this.logger.log(`[${input.noteId}] ✅ 通过 __INITIAL_STATE__ 获取到数据`);
        return parsed;
      }

      // 3) DOM 降级。state.global.firstVisitUrl 的 _rawValue 包含 /404/sec_xxx 则是被风控
      const blocked = isBlockedByRiskRedirect(state);
      this.logger.warn(
        `[${input.noteId}] ⚠️ state 不可用 (stateJsonLen=${stateJson?.length ?? 0}, xhrHits=${xhrRawByNoteId.size}, blocked=${blocked})，降级到 DOM 提取`,
      );
      
      // 尝试多种 DOM 选择器
      const dom = await page.evaluate(() => {
        const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() || undefined;
        const qa = (sel: string) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim()).filter(Boolean).join('\n');
        
        return {
          title: q('#detail-title') ?? q('.note-content .title') ?? q('h1'),
          content: q('#detail-desc') ?? q('.note-content .desc') ?? q('.content') ?? qa('.note-content p'),
          author: q('.author-wrapper .username') ?? q('.username') ?? q('.author-name'),
        };
      });
      
      this.logger.log(`[${input.noteId}] 📝 DOM 提取结果: title=${dom.title ? '✅' : '❌'}, content=${dom.content ? '✅' : '❌'}`);
      
      return {
        noteId: input.noteId,
        url,
        title: dom.title,
        content: dom.content,
        author: dom.author ? { nickname: dom.author } : undefined,
        fetchedAt: new Date().toISOString(),
        source: 'xhs',
      };
    } finally {
      page.off('response', onResponse);
    }
  }

  /**
   * 检测登录状态：检查是否出现二维码登录弹窗
   * @returns true 表示需要登录，false 表示已登录
   */
  private async checkLoginStatus(page: Page, noteId: string): Promise<boolean> {
    try {
      const needsLogin = await page.evaluate(() => {
        // 检测二维码登录弹窗
        const qrElements = document.querySelectorAll(
          '[class*="qr-code"], [class*="QRCode"], [class*="qrcode"], [class*="QR"]'
        );
        for (const el of qrElements) {
          const rect = el.getBoundingClientRect();
          // 二维码弹窗通常比较大
          if (rect.width > 150 && rect.height > 150) {
            return true;
          }
        }

        // 检测登录模态框
        const loginModals = document.querySelectorAll(
          '[class*="login-modal"], [class*="LoginModal"], [class*="modal"], [class*="dialog"]'
        );
        for (const modal of loginModals) {
          const text = modal.textContent || '';
          if ((text.includes('登录') || text.includes('扫码')) && modal.clientHeight > 200) {
            return true;
          }
        }

        // 检测页面是否重定向到登录页
        if (window.location.href.includes('/login')) {
          return true;
        }

        return false;
      });

      if (needsLogin) {
        this.logger.warn(`[${noteId}] ⚠️ 检测到二维码登录弹窗，需要先完成登录`);
      } else {
        this.logger.log(`[${noteId}] ✅ 登录状态正常，无弹窗`);
      }

      return needsLogin;
    } catch (err) {
      this.logger.warn(`[${noteId}] 登录状态检测失败: ${(err as Error).message}`);
      return false; // 检测失败，假设已登录
    }
  }

  /**
   * 等待用户扫码登录完成
   * 定期检测登录状态，直到弹窗消失（登录成功）
   */
  private async waitForLoginComplete(page: Page, noteId: string, timeoutMs = 120000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 3000; // 每 3 秒检查一次
    let checkCount = 0;

    this.logger.log(`[${noteId}] 🔐 等待用户扫码登录（最长 ${timeoutMs / 1000} 秒）...`);
    this.logger.log(`[${noteId}] 💡 请使用小红书 App 扫码登录`);

    while (Date.now() - startTime < timeoutMs) {
      checkCount++;
      
      // 等待一段时间
      await page.waitForTimeout(checkInterval);
      
      // 检查弹窗是否消失（登录成功）
      const stillNeedLogin = await this.checkLoginStatus(page, noteId);
      
      if (!stillNeedLogin) {
        this.logger.log(`[${noteId}] ✅ 登录成功！弹窗已消失（检查 ${checkCount} 次）`);
        
        // 登录成功后，等待页面稳定
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await randomSleep(2000, 3000);
        
        return;
      }
      
      // 每 10 次检查输出一次提示
      if (checkCount % 10 === 0) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        this.logger.log(`[${noteId}] ⏳ 等待中... 已等待 ${elapsed} 秒`);
      }
    }

    // 超时
    throw new Error(`[${noteId}] 登录超时（${timeoutMs / 1000} 秒），请重新尝试`);
  }
}

// ===== 辅助函数 =====

/** 判断 state 是否被小红书风控重定向到 /404/sec_xxx 安全验证页 */
function isBlockedByRiskRedirect(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false;
  const root = state as AnyObj;
  const g = root.global as AnyObj | undefined;
  if (!g) return false;
  const fv = g.firstVisitUrl as AnyObj | undefined;
  const raw = (fv?._rawValue ?? fv?._value ?? '') as unknown;
  return typeof raw === 'string' && /\/404\/sec_/.test(raw);
}

function indexNotePayload(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 7) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexNotePayload(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;
  const id =
    typeof obj.id === 'string' && /^[0-9a-fA-F]{16,}$/.test(obj.id) ? obj.id : undefined;
  const noteCard =
    (obj.note_card as AnyObj | undefined) ??
    (obj.noteCard as AnyObj | undefined) ??
    (obj.note as AnyObj | undefined);
  if (id && noteCard && typeof noteCard === 'object') {
    sink.set(id, noteCard);
  } else if (id && (obj.title !== undefined || obj.desc !== undefined || obj.interact_info)) {
    sink.set(id, obj);
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexNotePayload(v, sink, depth + 1);
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : v == null ? undefined : String(v);
}

function noteEntityFromRaw(raw: AnyObj, noteId: string, url: string): NoteEntity | null {
  const interact = (raw.interact_info ?? raw.interactInfo ?? {}) as AnyObj;
  const user = (raw.user ?? raw.userInfo ?? {}) as AnyObj;
  const title = asString(raw.title) ?? asString(raw.display_title) ?? asString(raw.desc);
  const desc = asString(raw.desc) ?? asString(raw.content);
  if (!title && !desc && !interact.liked_count && !interact.likedCount) return null;

  const timeRaw =
    raw.time ?? raw.publish_time ?? raw.publishTime ?? raw.last_update_time ?? raw.lastUpdateTime;
  let publishedAt: string | undefined;
  const ts = toNumber(timeRaw);
  if (ts !== undefined) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    publishedAt = new Date(ms).toISOString();
  } else if (typeof timeRaw === 'string') {
    const d = new Date(timeRaw);
    if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
  }

  return {
    noteId,
    url,
    type: asString(raw.type),
    title,
    content: desc,
    likedCount: toNumber(interact.liked_count) ?? toNumber(interact.likedCount),
    collectedCount: toNumber(interact.collected_count) ?? toNumber(interact.collectedCount),
    commentCount: toNumber(interact.comment_count) ?? toNumber(interact.commentCount),
    shareCount: toNumber(interact.share_count) ?? toNumber(interact.shareCount),
    author: {
      userId: asString(user.user_id) ?? asString(user.userId),
      nickname: asString(user.nickname),
      avatar: asString(user.avatar),
    },
    publishedAt,
    ipLocation: asString(raw.ip_location) ?? asString(raw.ipLocation),
    fetchedAt: new Date().toISOString(),
    source: 'xhs',
    raw,
  };
}
