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

# 执行主进程
exec node dist/main.js "$@"
