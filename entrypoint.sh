#!/bin/bash
# entrypoint.sh - Docker 容器启动脚本
# 自动启动 Xvfb 虚拟显示器（如果需要 Headed 模式）

set -e

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
  echo "💡 扫码登录提示："
  echo "   1. 触发登录: curl -X POST http://localhost:${PORT:-5510}/api/auth/login \\"
  echo "         -H 'Content-Type: application/json' \\"
  echo "         -d '{\"accountId\":\"default\"}'"
  echo "   2. 获取二维码截图:"
  echo "      docker exec supercrawler scrot -d :99 /tmp/qr.png -q 90"
  echo "      docker cp supercrawler:/tmp/qr.png ./qr.png"
  echo "      open ./qr.png  # macOS"
  echo "   3. 使用小红书 App 扫码"
  echo ""
  echo "📖 详细文档: DOCKER_LOGIN_GUIDE.md"
  echo ""
fi

# 执行主进程
exec node dist/main.js "$@"
