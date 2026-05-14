#!/bin/bash
# capture-qr.sh - 截取虚拟显示器中的二维码
# 用法: ./capture-qr.sh [输出路径]

set -e

OUTPUT_PATH="${1:-/tmp/qr-code.png}"
DISPLAY="${DISPLAY:-:99}"

echo "📸 正在截取虚拟显示器 (${DISPLAY}) 的截图..."

# 截取整个屏幕
scrot -d "$DISPLAY" "$OUTPUT_PATH" -q 90

if [ -f "$OUTPUT_PATH" ]; then
  FILE_SIZE=$(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH" 2>/dev/null || echo "unknown")
  echo "✅ 截图已保存: $OUTPUT_PATH (大小: $FILE_SIZE bytes)"
  echo ""
  echo "💡 使用以下命令查看："
  echo "   docker cp supercrawler:$OUTPUT_PATH ./qr-code.png"
  echo "   open ./qr-code.png  # macOS"
else
  echo "❌ 截图失败"
  exit 1
fi
