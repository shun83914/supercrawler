#!/usr/bin/env bash
# publish-docker.sh —— 构建并推送 supercrawler Docker 镜像
#
# 用法：
#   ./scripts/publish-docker.sh                    # 推 latest + 当前 git tag
#   ./scripts/publish-docker.sh --tag v0.2.0       # 指定版本号
#   ./scripts/publish-docker.sh --dry-run          # 只构建不推送
#
# 前提：
#   1. 已登录 Docker Hub: docker login
#   2. 或已登录 GHCR: echo $GH_TOKEN | docker login ghcr.io -u $GH_USER --password-stdin

set -euo pipefail

# ========== 配置 ==========
DOCKERHUB_USER="${DOCKERHUB_USER:-}"          # 你的 Docker Hub 用户名
DOCKERHUB_REPO="${DOCKERHUB_REPO:-supercrawler}"
GHCR_USER="${GHCR_USER:-}"                     # 你的 GitHub 用户名
PUSH_TO_DOCKERHUB=true
PUSH_TO_GHCR=true
DRY_RUN=false
TAGS=()

# ========== 解析参数 ==========
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAGS+=("$2"); shift 2 ;;
    --dockerhub-only) PUSH_TO_GHCR=false; shift ;;
    --ghcr-only) PUSH_TO_DOCKERHUB=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 如果没有指定 tag，用 latest + git tag
if [[ ${#TAGS[@]} -eq 0 ]]; then
  TAGS=("latest")
  GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  [[ -n "$GIT_TAG" ]] && TAGS+=("$GIT_TAG")
fi

# ========== 检查登录 ==========
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker 未运行"
  exit 1
fi

if $PUSH_TO_DOCKERHUB && [[ -z "$DOCKERHUB_USER" ]]; then
  echo "⚠️  未设置 DOCKERHUB_USER，跳过 Docker Hub 推送"
  PUSH_TO_DOCKERHUB=false
fi

if $PUSH_TO_GHCR && [[ -z "$GHCR_USER" ]]; then
  echo "⚠️  未设置 GHCR_USER，跳过 GHCR 推送"
  PUSH_TO_GHCR=false
fi

if ! $PUSH_TO_DOCKERHUB && ! $PUSH_TO_GHCR; then
  echo "❌ 至少需要设置 DOCKERHUB_USER 或 GHCR_USER"
  exit 1
fi

# ========== 构建镜像 ==========
echo "🔨 构建镜像 supercrawler:latest..."
docker build -t supercrawler:latest .

if [[ $? -ne 0 ]]; then
  echo "❌ 构建失败"
  exit 1
fi

echo "✅ 构建成功"

# ========== 推送 ==========
for tag in "${TAGS[@]}"; do
  echo ""
  echo "📦 处理 tag: $tag"

  if $PUSH_TO_DOCKERHUB; then
    IMAGE="${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}"
    echo "   → Docker Hub: $IMAGE"
    docker tag supercrawler:latest "$IMAGE"
    if ! $DRY_RUN; then
      docker push "$IMAGE"
    fi
  fi

  if $PUSH_TO_GHCR; then
    IMAGE="ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}"
    echo "   → GHCR: $IMAGE"
    docker tag supercrawler:latest "$IMAGE"
    if ! $DRY_RUN; then
      docker push "$IMAGE"
    fi
  fi
done

echo ""
if $DRY_RUN; then
  echo "✅ Dry run 完成（未推送）"
else
  echo "✅ 推送完成"
fi

echo ""
echo "📝 用户使用方式："
echo ""
echo "  # Docker Hub"
echo "  docker pull ${DOCKERHUB_USER:-<username>}/${DOCKERHUB_REPO}:latest"
echo ""
echo "  # GHCR"
echo "  docker pull ghcr.io/${GHCR_USER:-<username>}/${DOCKERHUB_REPO}:latest"
