#!/usr/bin/env bash
# init-first-run.sh —— SuperCrawler 首次使用一键初始化脚本
#
# 流程：
#   1) 前置检查（node/npm/curl，可选 jq）
#   2) 安装依赖 + 构建（如 dist 缺失）
#   3) 生成 / 复用 SUPERCRAWLER_TOKEN（写入 .env）
#   4) 后台启动服务，轮询 /api/health 等待就绪
#   5) 调用 /api/auth/login（服务端自动探测或弹浏览器扫码）
#   6) 打印下一步命令；脚本退出时自动 tail 服务日志位置（不 kill 服务）
#
# 用法：
#   ./scripts/init-first-run.sh                          # 默认 accountId=default
#   ./scripts/init-first-run.sh --account=work01
#   ./scripts/init-first-run.sh --port=3001              # 显式指定端口（优先级：--port > $PORT > .env > 5510）
#   ./scripts/init-first-run.sh --timeout=180            # 单次扫码最长等 180s
#   ./scripts/init-first-run.sh --keep-service=false     # 登录完成后停止服务（默认 true 保留）
#   ./scripts/init-first-run.sh --skip-build             # 复用 dist，跳过构建
#
# 退出码：
#   0  全部完成（服务在后台运行 + 账号已登录）
#   1  登录超时或失败
#   2  依赖缺失 / 构建失败 / 服务启动失败

set -euo pipefail

# ========== 读取 .env 中的 PORT（仅当前未设定 PORT 时生效） ==========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_PORT=""
if [[ -f "${ROOT}/.env" ]]; then
  ENV_PORT=$(grep -E '^PORT=[0-9]+' "${ROOT}/.env" | head -1 | cut -d= -f2 | tr -d ' \r' || true)
fi

# ========== 参数 ==========
ACCOUNT="default"
PORT="${PORT:-${ENV_PORT:-5510}}"   # 优先级：$PORT > .env > 5510
TIMEOUT=180
KEEP_SERVICE=true
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --account=*)          ACCOUNT="${arg#*=}" ;;
    --port=*)             PORT="${arg#*=}" ;;
    --timeout=*)          TIMEOUT="${arg#*=}" ;;
    --keep-service=false) KEEP_SERVICE=false ;;
    --keep-service=true)  KEEP_SERVICE=true ;;
    --skip-build)         SKIP_BUILD=true ;;
    -h|--help)            sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "❌ 未知参数: $arg" >&2; exit 2 ;;
  esac
done

# ========== 路径 ==========
cd "$ROOT"

ENV_FILE="${ROOT}/.env"
LOG_FILE="${ROOT}/logs/supercrawler.log"
PID_FILE="${ROOT}/logs/supercrawler.pid"
BASE="http://localhost:${PORT}"

mkdir -p "${ROOT}/logs" "${ROOT}/data/profiles" "${ROOT}/data/output"

banner() { echo ""; echo "═════════════ $1 ═════════════"; }

# ========== 1) 前置检查 ==========
banner "1/5  前置检查"

for cmd in node npm curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ 缺少依赖: $cmd" >&2
    exit 2
  fi
done

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "❌ Node.js 版本过低: $(node -v) （需 >= 18）" >&2
  exit 2
fi
echo "✅ node=$(node -v)  npm=$(npm -v)"

if ! command -v jq >/dev/null 2>&1; then
  echo "⚠️  未安装 jq，返回体解析将退化为 grep 模式（brew install jq / apt-get install jq）"
  HAS_JQ=false
else
  HAS_JQ=true
fi

# 端口占用检测
if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  PIDS=$(lsof -ti:"${PORT}")
  echo "⚠️  端口 ${PORT} 已被占用（PID=${PIDS}）"
  if [[ -f "$PID_FILE" ]] && echo "$PIDS" | grep -qx "$(cat "$PID_FILE")"; then
    echo "    检测到是本脚本先前启动的实例，复用之。"
    REUSE_SERVICE=true
  else
    echo "❌ 请先停止该进程或换端口: --port=XXXX" >&2
    exit 2
  fi
else
  REUSE_SERVICE=false
fi

# ========== 2) 依赖 + 构建 ==========
banner "2/5  依赖 & 构建"

if [[ ! -d "${ROOT}/node_modules" ]]; then
  echo "📦 首次安装依赖 (npm ci)..."
  npm ci || { echo "❌ npm ci 失败" >&2; exit 2; }
fi

if [[ "$SKIP_BUILD" == "true" && -f "${ROOT}/dist/main.js" ]]; then
  echo "⏭  --skip-build 跳过构建"
elif [[ ! -f "${ROOT}/dist/main.js" ]] || [[ "${ROOT}/src" -nt "${ROOT}/dist/main.js" ]]; then
  echo "🔨 正在构建..."
  npm run build || { echo "❌ 构建失败" >&2; exit 2; }
else
  echo "✅ dist 已是最新"
fi

# ========== 3) Token ==========
banner "3/5  Token 生成"

if [[ -f "$ENV_FILE" ]] && grep -qE '^API_TOKEN=[a-f0-9]{32,}' "$ENV_FILE"; then
  TOKEN=$(grep -E '^API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2)
  echo "♻️  复用已有 API_TOKEN（长度 ${#TOKEN}）"
else
  echo "🔑 生成新 token 并写入 .env ..."
  node "${SCRIPT_DIR}/gen-token.mjs" --force >/dev/null
  TOKEN=$(grep -E '^API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2)
  echo "✅ 已写入 .env (API_TOKEN=${TOKEN:0:8}...${TOKEN: -4})"
fi

export SUPERCRAWLER_TOKEN="$TOKEN"

# ========== 4) 启动服务 ==========
banner "4/5  启动服务"

if [[ "$REUSE_SERVICE" == "true" ]]; then
  echo "♻️  复用已在 :${PORT} 运行的实例"
else
  echo "🚀 后台启动 node dist/main.js ..."
  echo "    日志: ${LOG_FILE}"
  PORT="${PORT}" SUPERCRAWLER_TOKEN="${TOKEN}" \
    nohup node dist/main.js > "$LOG_FILE" 2>&1 &
  SERVICE_PID=$!
  echo "$SERVICE_PID" > "$PID_FILE"
  echo "    PID=${SERVICE_PID}"
fi

# 等健康
echo "⏳ 等待 ${BASE}/api/health 就绪..."
READY=false
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "${BASE}/api/health" >/dev/null 2>&1; then
    READY=true; break
  fi
  sleep 1
  printf "."
done
echo ""

if [[ "$READY" != "true" ]]; then
  echo "❌ 服务 30s 内未就绪，日志尾部："
  tail -n 30 "$LOG_FILE" 2>/dev/null || true
  if [[ "$REUSE_SERVICE" != "true" ]] && [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  exit 2
fi
echo "✅ 服务已就绪"

# 失败时自动清理后台服务
cleanup_on_error() {
  local ec=$?
  if [[ $ec -ne 0 && "$KEEP_SERVICE" == "true" ]]; then
    echo ""
    echo "⚠️  脚本异常退出（code=${ec}），后台服务保留（--keep-service=false 可关闭）"
    echo "    停止命令: kill \$(cat ${PID_FILE})"
  fi
}
trap cleanup_on_error EXIT

# ========== 5) 扫码登录 ==========
banner "5/5  扫码登录 (accountId=${ACCOUNT})"

echo "📱 即将调用 POST ${BASE}/api/auth/login"
echo "    · 若 data/profiles/${ACCOUNT} 已有有效 cookie → 自动探测通过（无感）"
echo "    · 否则服务端会弹出有头浏览器显示二维码，请用小红书 App 扫码"
echo "    最长等待 ${TIMEOUT}s"
echo ""

RESP=$(curl -sS --max-time $((TIMEOUT + 10)) -w '\n__HTTP_%{http_code}' \
  -X POST "${BASE}/api/auth/login" \
  -H "X-API-Key: ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"accountId\":\"${ACCOUNT}\"}" || echo $'\n__HTTP_000')

HTTP=$(echo "$RESP" | tail -n1 | sed 's/^__HTTP_//')
BODY=$(echo "$RESP" | sed '$d')

parse() {
  local key="$1"
  if [[ "$HAS_JQ" == "true" ]]; then
    echo "$BODY" | jq -r "${key} // empty" 2>/dev/null
  else
    # 朴素兜底
    echo "$BODY" | grep -oE "\"${key##*\.}\"[[:space:]]*:[[:space:]]*[^,}]*" | head -1 | sed -E 's/.*:[[:space:]]*"?([^",}]*)"?.*/\1/'
  fi
}

LOGGED=$(parse '.data.loggedIn')
CODE=$(parse '.code')
MSG=$(parse '.message')

echo ""
if [[ "$HTTP" == "200" || "$HTTP" == "201" ]] && [[ "$LOGGED" == "true" ]]; then
  echo "✅ 登录成功！账号 ${ACCOUNT} 已就绪。"
  SUCCESS=true
else
  echo "❌ 登录失败  http=${HTTP}  code=${CODE:-UNKNOWN}  msg=${MSG:-'(no msg)'}"
  SUCCESS=false
fi

# ========== 收尾 ==========
banner "完成"
echo "account    : ${ACCOUNT}"
echo "base       : ${BASE}"
echo "token      : ${TOKEN:0:8}...${TOKEN: -4}  (见 .env)"
echo "log        : ${LOG_FILE}"
[[ "$REUSE_SERVICE" != "true" ]] && echo "pid file   : ${PID_FILE}"
echo ""

if [[ "$SUCCESS" == "true" ]]; then
  echo "下一步："
  echo "  · 巡检账号健康：  npm run accounts:status"
  echo "  · 发起抓取测试：  curl -sS -X POST ${BASE}/api/xhs/search \\"
  echo "                       -H \"X-API-Key: \$SUPERCRAWLER_TOKEN\" -H 'Content-Type: application/json' \\"
  echo "                       -d '{\"keyword\":\"奶茶\",\"limit\":5}'"
  echo "  · 接入 OpenClaw：  参考 .openclaw/README.md"
  if [[ "$KEEP_SERVICE" == "false" ]] && [[ "$REUSE_SERVICE" != "true" ]]; then
    echo ""
    echo "🛑 --keep-service=false，停止后台服务 ..."
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  elif [[ "$REUSE_SERVICE" != "true" ]]; then
    echo ""
    echo "ℹ️  服务保留在后台运行（PID=$(cat "$PID_FILE") 端口=${PORT}）"
    echo "   停止命令: kill \$(cat ${PID_FILE})"
  fi
  trap - EXIT
  exit 0
else
  echo "排查建议："
  echo "  · 查看服务日志: tail -n 50 ${LOG_FILE}"
  echo "  · 确认本机有 GUI（headful 扫码需要有屏幕）"
  echo "  · 服务端 CLOAK_HEADLESS 必须为 false（首次扫码时）"
  echo "  · 可重试: ./scripts/init-first-run.sh --account=${ACCOUNT}"
  trap - EXIT
  exit 1
fi
