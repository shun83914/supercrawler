#!/usr/bin/env bash
# publish-docker.sh —— 构建并推送 supercrawler Docker 镜像
#
# 用法：
#   ./scripts/publish-docker.sh                    # 推 latest + 当前 git tag
#   ./scripts/publish-docker.sh --tag v0.2.0       # 指定版本号
#   ./scripts/publish-docker.sh --dry-run          # 只构建不推送
#   ./scripts/publish-docker.sh --debian-only      # 只构建 Debian 版本
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
DEBIAN_ONLY=false
TAGS=()

# ========== 解析参数 ==========
while [[ $# -gt 0 ]]; do
  case $1 in
    --tag) TAGS+=("$2"); shift 2 ;;
    --dockerhub-only) PUSH_TO_GHCR=false; shift ;;
    --ghcr-only) PUSH_TO_DOCKERHUB=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --debian-only) DEBIAN_ONLY=true; shift ;;
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

# 网络提示
if $PUSH_TO_DOCKERHUB; then
  echo "⚠️  提示: Docker Hub 在国内访问可能不稳定"
  echo "   如果构建失败，建议只推送到 GHCR:"
  echo "   GHCR_USER=shun83914 ./scripts/publish-docker.sh"
  echo ""
fi

# ========== 检查 buildx 是否可用 ==========
if ! docker buildx version >/dev/null 2>&1; then
  echo "❌ 需要安装 Docker Buildx 插件"
  echo "   安装指南: https://docs.docker.com/build/install-buildx/"
  exit 1
fi

# 创建或使用 multi-platform builder
echo "🔧 初始化 Buildx builder..."
# 如果 builder 不存在则创建，否则重用
if ! docker buildx inspect supercrawler-builder >/dev/null 2>&1; then
  docker buildx create --name supercrawler-builder --use
  echo "   ✅ 创建新 builder: supercrawler-builder"
else
  docker buildx use supercrawler-builder
  echo "   ✅ 使用已有 builder: supercrawler-builder"
fi

# 启动 builder（如果需要）
docker buildx inspect --bootstrap supercrawler-builder >/dev/null 2>&1

# ========== 构建多架构镜像 ==========
if $DEBIAN_ONLY; then
  echo "🔨 构建 Debian 版本多架构镜像 (linux/amd64, linux/arm64)..."
  DOCKERFILE="Dockerfile.debian"
  TAG_SUFFIX="-debian"
else
  echo "🔨 构建 Alpine 版本多架构镜像 (linux/amd64, linux/arm64)..."
  DOCKERFILE="Dockerfile"
  TAG_SUFFIX=""
fi

# 构建目标 tags
BUILD_TAGS=()
if $PUSH_TO_DOCKERHUB && [[ -n "$DOCKERHUB_USER" ]]; then
  for tag in "${TAGS[@]}"; do
    BUILD_TAGS+=("-t" "${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}")
  done
fi

if $PUSH_TO_GHCR && [[ -n "$GHCR_USER" ]]; then
  for tag in "${TAGS[@]}"; do
    BUILD_TAGS+=("-t" "ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}")
  done
fi

# 构建命令
if $DRY_RUN; then
  echo "   [Dry run] 构建以下 tags:"
  for tag in "${TAGS[@]}"; do
    [[ -n "$DOCKERHUB_USER" ]] && echo "     - ${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}"
    [[ -n "$GHCR_USER" ]] && echo "     - ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}"
  done
  echo ""
  echo "   执行命令:"
  echo "   docker buildx build --platform linux/amd64,linux/arm64 -f ${DOCKERFILE} ${BUILD_TAGS[*]} --push ."
else
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -f "$DOCKERFILE" \
    "${BUILD_TAGS[@]}" \
    --push \
    --pull=false \
    .
fi

if [[ $? -ne 0 ]]; then
  echo "❌ 构建失败"
  exit 1
fi

echo "✅ 构建成功"

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
