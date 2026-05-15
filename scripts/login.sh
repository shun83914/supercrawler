#!/bin/bash
# login.sh - 独立登录脚本（不依赖 OpenClaw 服务）
# 
# 用法：
#   ./scripts/login.sh xhs [accountId]     # 小红书登录
#   ./scripts/login.sh douyin [accountId]  # 抖音登录
#
# 示例：
#   ./scripts/login.sh xhs                 # 登录小红书 default 账号
#   ./scripts/login.sh xhs default         # 登录小红书 default 账号
#   ./scripts/login.sh xhs biz1            # 登录小红书 biz1 账号
#   ./scripts/login.sh douyin              # 登录抖音 default 账号

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 参数解析
PLATFORM="${1:-xhs}"
ACCOUNT_ID="${2:-default}"
CONTAINER_NAME="supercrawler-login-$$"  # 使用 PID 避免冲突
DATA_DIR="${SUPERCRAWLER_DATA_DIR:-$HOME/supercrawler-test/data}"
IMAGE_NAME="${SUPERCRAWLER_IMAGE:-supercrawler:latest}"
PORT="${SUPERCRAWLER_PORT:-5510}"

# 验证平台参数
if [[ "$PLATFORM" != "xhs" && "$PLATFORM" != "douyin" ]]; then
  echo -e "${RED}❌ 错误：平台参数必须是 xhs 或 douyin${NC}"
  echo "用法: $0 <xhs|douyin> [accountId]"
  exit 1
fi

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}🔐 SuperCrawler 登录工具${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""
echo -e "平台: ${GREEN}$PLATFORM${NC}"
echo -e "账号: ${GREEN}$ACCOUNT_ID${NC}"
echo -e "数据目录: ${GREEN}$DATA_DIR${NC}"
echo -e "容器名称: ${GREEN}$CONTAINER_NAME${NC}"
echo ""

# Step 1: 检查 Docker 是否运行
echo -e "${YELLOW}Step 1: 检查 Docker 环境...${NC}"
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}❌ Docker 未运行，请先启动 Docker Desktop${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Docker 运行正常${NC}"
echo ""

# Step 2: 检查镜像是否存在
echo -e "${YELLOW}Step 2: 检查 Docker 镜像...${NC}"
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo -e "${RED}❌ 镜像 $IMAGE_NAME 不存在${NC}"
  echo ""
  echo "请先构建镜像："
  echo "  docker build -f Dockerfile.debian -t supercrawler:latest ."
  echo ""
  echo "或从仓库拉取："
  echo "  docker pull ghcr.io/your-org/supercrawler:latest"
  exit 1
fi
echo -e "${GREEN}✅ 镜像 $IMAGE_NAME 存在${NC}"
echo ""

# Step 3: 停止旧容器（如果有）
echo -e "${YELLOW}Step 3: 清理旧容器...${NC}"
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "停止并删除旧容器 $CONTAINER_NAME..."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  echo -e "${GREEN}✅ 旧容器已清理${NC}"
else
  echo -e "${GREEN}✅ 无旧容器${NC}"
fi
echo ""

# Step 4: 启动 Headed 容器
echo -e "${YELLOW}Step 4: 启动 Headed 容器（支持扫码登录）...${NC}"
docker run -d --name "$CONTAINER_NAME" -p "$PORT:5510" \
  -v "$DATA_DIR:/data" \
  -e CLOAK_HEADLESS=false \
  -e DISPLAY=:99 \
  "$IMAGE_NAME" >/dev/null

echo -e "${GREEN}✅ 容器启动成功${NC}"
echo ""

# Step 5: 等待服务就绪
echo -e "${YELLOW}Step 5: 等待服务就绪...${NC}"
for i in {1..30}; do
  if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ 服务就绪（${i}秒）${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}❌ 服务启动超时（30秒）${NC}"
    echo "查看日志: docker logs $CONTAINER_NAME"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 1
done
echo ""

# Step 6: 触发登录
echo -e "${YELLOW}Step 6: 触发$PLATFORM登录...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"$ACCOUNT_ID\",\"platform\":\"$PLATFORM\"}")

echo "$LOGIN_RESPONSE" | jq .

# 检查登录是否立即成功（如果 cookies 仍有效）
LOGGED_IN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.loggedIn // false')
if [ "$LOGGED_IN" = "true" ]; then
  echo ""
  echo -e "${GREEN}=========================================${NC}"
  echo -e "${GREEN}✅ 登录成功（cookies 仍有效）！${NC}"
  echo -e "${GREEN}=========================================${NC}"
  
  # 清理容器
  echo ""
  echo "清理登录容器..."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1
  
  exit 0
fi

echo ""
echo -e "${YELLOW}⏳ 等待浏览器加载二维码...${NC}"
sleep 5

# Step 7: 获取二维码
echo -e "${YELLOW}Step 7: 获取登录二维码...${NC}"
QR_PATH="/tmp/${PLATFORM}-${ACCOUNT_ID}-qr.png"

QR_RESPONSE=$(curl -s "http://localhost:$PORT/api/auth/qr-screenshot?platform=$PLATFORM")
QR_SUCCESS=$(echo "$QR_RESPONSE" | jq -r '.success')

if [ "$QR_SUCCESS" != "true" ]; then
  echo -e "${RED}❌ 获取二维码失败${NC}"
  echo "$QR_RESPONSE" | jq .
  echo ""
  echo "查看容器日志:"
  echo "  docker logs $CONTAINER_NAME"
  echo ""
  echo "清理容器:"
  echo "  docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME"
  exit 1
fi

# 保存二维码
echo "$QR_RESPONSE" | jq -r '.qrCode' | sed 's/data:image\/png;base64,//' | base64 -d > "$QR_PATH"

echo -e "${GREEN}✅ 二维码已保存到: $QR_PATH${NC}"
echo ""

# Step 8: 打开二维码
if command -v open >/dev/null 2>&1; then
  echo -e "${YELLOW}📱 打开二维码图片...${NC}"
  open "$QR_PATH"
elif command -v xdg-open >/dev/null 2>&1; then
  echo -e "${YELLOW}📱 打开二维码图片...${NC}"
  xdg-open "$QR_PATH"
else
  echo -e "${YELLOW}📱 请手动打开二维码图片: $QR_PATH${NC}"
fi

echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}📱 请使用$PLATFORM App 扫码${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Step 9: 等待扫码登录
echo -e "${YELLOW}Step 9: 等待扫码登录...${NC}"
echo "(按 Ctrl+C 取消登录)"

while true; do
  STATUS_RESPONSE=$(curl -s "http://localhost:$PORT/api/auth/status?accountId=$ACCOUNT_ID&platform=$PLATFORM")
  LOGGED_IN=$(echo "$STATUS_RESPONSE" | jq -r '.data.loggedIn')
  
  if [ "$LOGGED_IN" = "true" ]; then
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}✅ 登录成功！${NC}"
    echo -e "${GREEN}=========================================${NC}"
    
    USER_ID=$(echo "$STATUS_RESPONSE" | jq -r '.data.userId // "unknown"')
    NICKNAME=$(echo "$STATUS_RESPONSE" | jq -r '.data.nickname // "unknown"')
    
    echo ""
    echo "用户ID: $USER_ID"
    echo "昵称: $NICKNAME"
    echo ""
    
    break
  fi
  
  # 显示等待动画
  for char in "⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏"; do
    printf "\r${YELLOW}%s 等待扫码...${NC}" "$char"
    sleep 0.1
  done
done

# Step 10: 清理容器
echo ""
echo -e "${YELLOW}Step 10: 清理登录容器...${NC}"
docker stop "$CONTAINER_NAME" >/dev/null 2>&1
docker rm "$CONTAINER_NAME" >/dev/null 2>&1
echo -e "${GREEN}✅ 容器已清理${NC}"

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}✅ 登录完成！${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "登录数据已保存到: $DATA_DIR/profiles/$ACCOUNT_ID"
echo ""
echo "下一步："
echo "  - 启动 OpenClaw 服务（Headless 模式）"
echo "  - 开始抓取数据"
echo ""
