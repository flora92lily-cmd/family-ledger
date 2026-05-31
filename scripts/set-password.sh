#!/usr/bin/env bash
# 设置/重置 Caddy Basic Auth 密码
# 用法：bash scripts/set-password.sh [密码] [用户名]
#   不传参数会交互式提示
#   用户名不传默认 family
#
# 这个脚本会处理 docker compose env_file 的 $ 插值坑：
# 自动把 bcrypt hash 里的每个 $ 转义为 $$。

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "${1:-}" ]]; then
  PLAIN="$1"
else
  read -rsp "新密码: " PLAIN
  echo
fi

USER_NAME="${2:-family}"
PORT="${CADDY_HOST_PORT:-18080}"

if [[ -z "$PLAIN" ]]; then
  echo "❌ 密码不能为空"
  exit 1
fi

echo "==> 生成 bcrypt hash"
RAW_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PLAIN")

echo "==> 转义 \$ -> \$\$（绕开 docker compose env_file 插值）"
ESC_HASH="${RAW_HASH//\$/\$\$}"

echo "==> 写入 .env"
cat > .env <<EOF
BASIC_AUTH_USER=$USER_NAME
BASIC_AUTH_HASH=$ESC_HASH
CADDY_HOST_PORT=$PORT
EOF

echo "==> 强制重建 caddy 容器"
docker compose up -d --force-recreate caddy

echo "==> 等待 caddy 启动"
sleep 2

echo "==> 验证容器内环境变量（hash 应该完整且不含 \$\$）"
docker compose exec caddy printenv | grep BASIC_AUTH

echo "==> curl 测试"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -u "$USER_NAME:$PLAIN" "http://127.0.0.1:$PORT/")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✅ 认证成功（HTTP 200）"
  echo "用户名: $USER_NAME"
  echo "端口:   $PORT"
else
  echo "❌ 认证失败（HTTP $HTTP_CODE）"
  echo "看下 caddy 日志: docker compose logs --tail 30 caddy"
  exit 1
fi
