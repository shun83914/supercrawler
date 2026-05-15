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
# 不再使用 buildx，改为分别构建两个架构
echo "ℹ️  将分别构建 amd64 和 arm64 架构镜像"

# ========== 构建镜像（分别构建两个架构） ==========
if $DEBIAN_ONLY; then
  echo "🔨 构建 Debian 版本镜像..."
  DOCKERFILE="Dockerfile.debian"
  TAG_SUFFIX="-debian"
else
  echo "🔨 构建 Alpine 版本镜像..."
  DOCKERFILE="Dockerfile"
  TAG_SUFFIX=""
fi

# 获取当前架构
CURRENT_ARCH=$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)
if [[ "$CURRENT_ARCH" == "x86_64" ]]; then
  CURRENT_ARCH="amd64"
elif [[ "$CURRENT_ARCH" == "aarch64" || "$CURRENT_ARCH" == "arm64" ]]; then
  CURRENT_ARCH="arm64"
fi

echo "📊 当前架构: $CURRENT_ARCH"

# 构建目标架构列表
TARGET_ARCHS=("amd64" "arm64")

for ARCH in "${TARGET_ARCHS[@]}"; do
  echo ""
  echo "========================================"
  echo "🔨 构建架构: linux/$ARCH"
  echo "========================================"
  
  # 生成临时标签（带架构后缀）
  TEMP_TAGS=()
  if $PUSH_TO_DOCKERHUB && [[ -n "$DOCKERHUB_USER" ]]; then
    for tag in "${TAGS[@]}"; do
      TEMP_TAGS+=("-t" "${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}")
    done
  fi
  
  if $PUSH_TO_GHCR && [[ -n "$GHCR_USER" ]]; then
    for tag in "${TAGS[@]}"; do
      TEMP_TAGS+=("-t" "ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}")
    done
  fi
  
  if $DRY_RUN; then
    echo "   [Dry run] 将构建以下 tags:"
    for tag in "${TAGS[@]}"; do
      [[ -n "$DOCKERHUB_USER" ]] && echo "     - ${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
      [[ -n "$GHCR_USER" ]] && echo "     - ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
    done
  else
    # 构建当前架构的镜像
    echo "   开始构建 linux/$ARCH..."
    docker build \
      -f "$DOCKERFILE" \
      "${TEMP_TAGS[@]}" \
      --platform "linux/$ARCH" \
      .
    
    if [[ $? -ne 0 ]]; then
      echo "❌ 构建 linux/$ARCH 失败"
      exit 1
    fi
    
    echo "   ✅ linux/$ARCH 构建成功"
    
    # 推送到仓库
    echo "   📤 推送 linux/$ARCH 镜像..."
    if $PUSH_TO_DOCKERHUB && [[ -n "$DOCKERHUB_USER" ]]; then
      for tag in "${TAGS[@]}"; do
        echo "     推送: ${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
        docker push "${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
        if [[ $? -ne 0 ]]; then
          echo "❌ 推送 ${DOCKERHUB_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH} 失败"
          exit 1
        fi
      done
    fi
    
    if $PUSH_TO_GHCR && [[ -n "$GHCR_USER" ]]; then
      for tag in "${TAGS[@]}"; do
        echo "     推送: ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
        docker push "ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH}"
        if [[ $? -ne 0 ]]; then
          echo "❌ 推送 ghcr.io/${GHCR_USER}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-${ARCH} 失败"
          exit 1
        fi
      done
    fi
    
    echo "   ✅ linux/$ARCH 推送完成"
  fi
done

echo ""
echo "========================================"
if $DRY_RUN; then
  echo "✅ Dry run 完成（未推送）"
else
  echo "✅ 所有架构构建并推送完成"
fi

echo ""
echo "📝 用户使用方式："
echo ""
echo "  # Docker Hub"
for tag in "${TAGS[@]}"; do
  echo "  docker pull ${DOCKERHUB_USER:-<username>}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-amd64  # AMD64"
  echo "  docker pull ${DOCKERHUB_USER:-<username>}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-arm64  # ARM64"
  echo ""
done

echo "  # GHCR"
for tag in "${TAGS[@]}"; do
  echo "  docker pull ghcr.io/${GHCR_USER:-<username>}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-amd64  # AMD64"
  echo "  docker pull ghcr.io/${GHCR_USER:-<username>}/${DOCKERHUB_REPO}:${tag}${TAG_SUFFIX}-arm64  # ARM64"
  echo ""
done
