#!/usr/bin/env bash
# relogin-all.sh —— 扫描所有失效账号，依次触发 login 接口重登录。
#
# 策略（两阶段，匹配服务端 login 实现）：
#   1. 先 GET /api/auth/status 判定账号是否真失效（避免对健康账号弹浏览器）。
#   2. 对失效账号 POST /api/auth/login：
#      - 若 profile 里 cookie 仍有效，服务端内部会自动探测成功，无感知。
#      - 否则服务端拉起有头浏览器显示二维码，脚本会提示你用手机扫码。
#
# 用法：
#   ./scripts/relogin-all.sh                            # 交互式：每个账号依次扫码
#   ./scripts/relogin-all.sh --yes                      # 跳过确认
#   ./scripts/relogin-all.sh --base=http://host:5510  # 指定远端
#                                                     # 端口优先级：--base > $PORT > .env PORT > 5510
#   ./scripts/relogin-all.sh --only=acc_a,acc_b         # 只重登指定账号
#   ./scripts/relogin-all.sh --timeout=180              # 单账号最长等待秒数（默认 180）
#
# 退出码：
#   0  成功（全部失效账号都重新登录成功）
#   1  至少 1 个账号仍失效
#   2  服务不可达 / PROFILE_DIR 为空
#
# 依赖：curl, jq（可通过 brew install jq 或 apt-get install jq 安装）

set -euo pipefail

# ---- 读取 .env PORT ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_PORT=""
if [[ -f "${ROOT}/.env" ]]; then
  ENV_PORT=$(grep -E '^PORT=[0-9]+' "${ROOT}/.env" | head -1 | cut -d= -f2 | tr -d ' \r' || true)
fi
RESOLVED_PORT="${PORT:-${ENV_PORT:-5510}}"

# ---- 参数解析 ----
BASE="http://localhost:${RESOLVED_PORT}"
AUTO_YES=false
ONLY=""
TIMEOUT=180

for arg in "$@"; do
  case "$arg" in
    --yes|-y)        AUTO_YES=true ;;
    --base=*)        BASE="${arg#*=}" ;;
    --only=*)        ONLY="${arg#*=}" ;;
    --timeout=*)     TIMEOUT="${arg#*=}" ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "❌ 未知参数: $arg" >&2
      exit 2
      ;;
  esac
done

TOKEN="${SUPERCRAWLER_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "⚠️  SUPERCRAWLER_TOKEN 未设置，如服务启用鉴权将被拒。" >&2
  echo "   可先执行: export SUPERCRAWLER_TOKEN=\$(npm run -s gen-token -- --print-only | head -1)" >&2
fi

AUTH_HEADER=()
[[ -n "$TOKEN" ]] && AUTH_HEADER=(-H "X-API-Key: ${TOKEN}")

# bash set -u 下空数组展开需用 ${arr[@]+...} 防 unbound
auth_args() { echo "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}"; }

# ---- 依赖检查 ----
command -v jq   >/dev/null 2>&1 || { echo "❌ 需要 jq: brew install jq | apt-get install jq" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "❌ 需要 curl" >&2; exit 2; }

# ---- 1. 服务可达性 ----
if ! curl -fsS --max-time 5 ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} "${BASE}/api/health" > /dev/null; then
  echo "❌ supercrawler 不可达: ${BASE}/api/health" >&2
  echo "   请先: npm run start:dev  或  docker compose up -d" >&2
  exit 2
fi

# ---- 2. 用 accounts-status 发现失效账号 ----
echo "🔎 正在扫描账号状态..."
STATUS_JSON=$(
  SUPERCRAWLER_TOKEN="${TOKEN}" \
    node "$(dirname "$0")/accounts-status.mjs" --json --base="${BASE}"
) || true  # 部分失效时退出码非 0，但 JSON 仍有效

TOTAL=$(echo "$STATUS_JSON" | jq -r '.total // 0')
if [[ "$TOTAL" -eq 0 ]]; then
  echo "❌ PROFILE_DIR 下无任何账号，请先手动扫码建立第一个账号:"
  echo "   curl -X POST ${BASE}/api/auth/login \\"
  echo "     -H 'X-API-Key: \$SUPERCRAWLER_TOKEN' \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"accountId\":\"default\"}'"
  exit 2
fi

# 过滤失效账号
UNHEALTHY=$(echo "$STATUS_JSON" | jq -r '.accounts[] | select(.loggedIn==false) | .accountId')

if [[ -n "$ONLY" ]]; then
  # --only 模式：只保留交集
  IFS=',' read -r -a WANTED <<< "$ONLY"
  FILTERED=""
  for acc in "${WANTED[@]}"; do
    if echo "$UNHEALTHY" | grep -qx "$acc"; then
      FILTERED+="${acc}"$'\n'
    fi
  done
  UNHEALTHY="${FILTERED%$'\n'}"
fi

if [[ -z "$UNHEALTHY" ]]; then
  echo "✅ 所有账号都已登录，无需重登。"
  exit 0
fi

COUNT=$(echo "$UNHEALTHY" | grep -c . || true)
echo "⚠️  发现 ${COUNT} 个失效账号："
echo "$UNHEALTHY" | sed 's/^/   - /'
echo ""

if [[ "$AUTO_YES" != "true" ]]; then
  read -r -p "继续重登吗？服务端会依次弹浏览器显示二维码 [y/N]: " ANS
  if [[ ! "$ANS" =~ ^[Yy]$ ]]; then
    echo "🛑 已取消"
    exit 1
  fi
fi

# ---- 3. 逐账号 login ----
SUCCESS=0
FAIL=0
FAIL_LIST=""
idx=0
while IFS= read -r ACC; do
  [[ -z "$ACC" ]] && continue
  idx=$((idx + 1))
  echo ""
  echo "────────────────────────────────────────────────"
  echo "[${idx}/${COUNT}] 🔄 重登: ${ACC}"
  echo "   1) 服务端会先自动探测 cookie 是否已恢复（无感）"
  echo "   2) 探测失败会弹浏览器显示二维码 → 请用小红书 App 扫码"
  echo "   最长等待 ${TIMEOUT}s"
  echo "────────────────────────────────────────────────"

  RESP=$(curl -sS --max-time $((TIMEOUT + 10)) -w '\n__HTTP_%{http_code}' \
    -X POST "${BASE}/api/auth/login" \
    ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} \
    -H 'Content-Type: application/json' \
    -d "{\"accountId\":\"${ACC}\"}" || echo $'\n__HTTP_000')

  HTTP=$(echo "$RESP" | tail -n1 | sed 's/^__HTTP_//')
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$HTTP" == "200" || "$HTTP" == "201" ]]; then
    LOGGED=$(echo "$BODY" | jq -r '.data.loggedIn // false')
    if [[ "$LOGGED" == "true" ]]; then
      echo "✅ ${ACC} 登录成功"
      SUCCESS=$((SUCCESS + 1))
      continue
    fi
  fi

  CODE=$(echo "$BODY" | jq -r '.code // "UNKNOWN"' 2>/dev/null || echo "UNKNOWN")
  MSG=$(echo "$BODY"  | jq -r '.message // .error // "(no msg)"' 2>/dev/null || echo "(no msg)")
  echo "❌ ${ACC} 登录失败  http=${HTTP}  code=${CODE}  msg=${MSG}"
  FAIL=$((FAIL + 1))
  FAIL_LIST+="${ACC} "
done <<< "$UNHEALTHY"

# ---- 4. 汇总 ----
echo ""
echo "========== 汇总 =========="
echo "成功: ${SUCCESS}   失败: ${FAIL}"
[[ -n "$FAIL_LIST" ]] && echo "仍失败的账号: ${FAIL_LIST}"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
