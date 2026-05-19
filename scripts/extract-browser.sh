#!/bin/bash
# 浏览器包解压脚本（Docker 构建时调用）

set -e

TARGETARCH=${TARGETARCH:-arm64}
BROWSER_PATH="/root/.cloakbrowser"

echo "📦 开始解压浏览器包 (架构: $TARGETARCH)..."

# 创建目标目录
mkdir -p "$BROWSER_PATH"

# 使用 CloakBrowser 期望的目录名（无架构后缀）
# 这样 CloakBrowser 会识别到浏览器已存在，不会重复下载
CHROMIUM_DIR="$BROWSER_PATH/chromium-146.0.7680.177.4"

# 创建版本目录
mkdir -p "$CHROMIUM_DIR"

# 解压浏览器包（已经是当前架构的包）
echo "📂 解压到: $CHROMIUM_DIR"
tar -xzf /browser/browser.tar.gz -C "$CHROMIUM_DIR"

# 验证
if [ -f "$CHROMIUM_DIR/chrome" ]; then
  echo "✅ 浏览器解压成功: $CHROMIUM_DIR/chrome"
  ls -lh "$CHROMIUM_DIR/chrome"
else
  echo "❌ 解压失败，找不到 chrome 可执行文件"
  exit 1
fi

echo "🎉 浏览器准备完成！"
echo "💡 CloakBrowser 将使用预装的浏览器，不会重复下载"
