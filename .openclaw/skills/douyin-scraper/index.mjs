/**
 * douyin-scraper skill 钩子：调用前检查 supercrawler MCP 是否就绪；
 * 调用后识别风控/验证码错误码发出预警日志。
 *
 * OpenClaw 会在每次 tool_call 前后调用导出的 onBeforeInvoke / onAfterInvoke。
 */

const HEALTH_URL = `http://localhost:${process.env.PORT || 5510}/api/health`;
const HEALTH_TIMEOUT_MS = 1500;

export async function onBeforeInvoke({ toolName }) {
  if (!toolName?.startsWith('supercrawler:')) return;

  // 纯 stdio MCP 时 HTTP 可能没起；这里只做 best-effort 存活探测，失败不抛
  try {
    const token = process.env.SUPERCRAWLER_TOKEN ?? '';
    const headers = token ? { 'X-API-Key': token } : {};
    const res = await fetch(HEALTH_URL, {
      headers,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[douyin-scraper] ⚠️  health 返回 ${res.status}，MCP stdio 仍可工作但 storage_peek HTTP 不可用`);
    }
  } catch {
    // HTTP 未启动时静默通过——MCP stdio 路径不依赖 HTTP
  }
}

export async function onAfterInvoke({ toolName, result }) {
  if (!toolName?.startsWith('supercrawler:')) return;
  if (!result?.isError) return;

  const txt = result?.content?.[0]?.text ?? '';
  // 关键失败码预警
  if (/DOUYIN_CAPTCHA/.test(txt)) {
    console.error(`[douyin-scraper] 🧩 触发抖音验证码，需用 auth_login 在 headed 浏览器中人工通过：${txt.slice(0, 200)}`);
  } else if (/RATE_LIMITED|DOUYIN_BLOCKED/.test(txt)) {
    console.error(`[douyin-scraper] 🚨 风控触发，建议退避 5+ 分钟停止调用：${txt.slice(0, 200)}`);
  } else if (/LOGIN_REQUIRED|LOGIN_TIMEOUT/.test(txt)) {
    console.error(`[douyin-scraper] 🔐 登录态失效，需 auth_login(platform="douyin")：${txt.slice(0, 200)}`);
  }
}
