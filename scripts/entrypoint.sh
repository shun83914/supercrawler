#!/bin/bash
# entrypoint.sh - Docker 容器启动脚本
# 自动启动 Xvfb 虚拟显示器（如果需要 Headed 模式）
# 自动检查并预下载 Chromium 浏览器

set -e

# 清理浏览器锁文件（防止异常退出后无法启动）
echo "🔧 清理浏览器锁文件..."
if [ -d "/data/profiles" ]; then
  find /data/profiles -name "SingletonLock" -delete 2>/dev/null || true
  find /data/profiles -name "SingletonSocket" -delete 2>/dev/null || true
  echo "✅ 锁文件清理完成"
else
  echo "ℹ️  /data/profiles 目录不存在，跳过清理"
fi
echo ""

# 检查并预下载 Chromium 浏览器
# CloakBrowser 实际路径（支持环境变量配置）
BROWSERS_PATH="${CLOAK_BROWSER_PATH:-/root/.cloakbrowser}"
CHROMIUM_DIR="$BROWSERS_PATH/chromium-*"

echo "🌐 检查 Chromium 浏览器..."
if ls $CHROMIUM_DIR 1> /dev/null 2>&1; then
  echo "✅ Chromium 浏览器已存在"
  ls -lh $CHROMIUM_DIR | head -1
else
  echo "⚠️  Chromium 浏览器未找到，请检查镜像是否预装了浏览器"
  echo "   检查路径: $BROWSERS_PATH"
  echo "   提示: Docker 镜像已预装浏览器，不应出现此提示"
fi
echo ""

# 检查是否需要启动 Xvfb（Headed 模式）
if [ "$CLOAK_HEADLESS" = "false" ]; then
  echo "🖥️  检测到 CLOAK_HEADLESS=false，启动 Xvfb 虚拟显示器..."
  
  # 启动 Xvfb（虚拟显示器 :99，分辨率 1920x1080x24）
  Xvfb :99 -screen 0 1920x1080x24 -ac &
  XVFB_PID=$!
  
  # 设置 DISPLAY 环境变量
  export DISPLAY=:99
  
  # 等待 Xvfb 启动
  sleep 1
  
  # 验证 Xvfb 是否启动成功
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "✅ Xvfb 虚拟显示器启动成功 (DISPLAY=:99)"
    echo "   分辨率: 1920x1080x24"
  else
    echo "❌ Xvfb 启动失败"
    exit 1
  fi
else
  echo "🔇 检测到 CLOAK_HEADLESS=true，使用 Headless 模式（无需 Xvfb）"
fi

echo ""
echo "🚀 启动 SuperCrawler 服务..."
echo "   端口: ${PORT:-5510}"
echo "   Headless: ${CLOAK_HEADLESS:-true}"
echo ""

# 如果是 Headed 模式，提示如何获取二维码
if [ "$CLOAK_HEADLESS" = "false" ]; then
  echo "📱 Headed 模式已启用（支持扫码登录）"
  echo ""
  echo "⚠️  首次登录提示："
  echo "   如果是首次运行，Chromium 浏览器会自动下载（约 2-5 分钟）"
  echo "   请等待浏览器下载完成后再触发登录"
  echo "   可以通过以下端点检查浏览器状态："
  echo "   curl http://localhost:${PORT:-5510}/api/browser/status"
  echo ""
  echo "💡 扫码登录步骤："
  echo "   1. 检查浏览器就绪: curl http://localhost:${PORT:-5510}/api/browser/status"
  echo "   2. 触发登录: curl -X POST http://localhost:${PORT:-5510}/api/auth/login \\"
  echo "         -H 'Content-Type: application/json' \\"
  echo "         -d '{\"accountId\":\"default\",\"platform\":\"xhs\"}'"
  echo "   3. 等待 5-10 秒让页面加载"
  echo "   4. 获取二维码截图:"
  echo "      curl -s http://localhost:${PORT:-5510}/api/auth/qr-screenshot?platform=xhs"
  echo "   5. 使用小红书 App 扫码"
  echo ""
  echo "📖 详细文档: DOCKER_LOGIN_GUIDE.md"
  echo ""
fi

# 执行主进程
exec node dist/main.js "$@"
