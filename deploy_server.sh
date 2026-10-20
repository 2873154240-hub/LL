#!/usr/bin/env bash
# ============================================================
# 明析 AI · 国内云服务器一键部署脚本（Ubuntu 22.04+ / Debian）
#
# 用法（在服务器上执行，推荐用 root 或 sudo）：
#   sudo bash deploy_server.sh
#
# 本脚本假设：
#   - 你的代码在 GitHub：git@github.com:2873154240-hub/LL.git
#   - 服务器已配置好 SSH 密钥访问 GitHub（脚本会引导确认）
# 会安装：nginx、python3-venv、构建前端(需 node)
# 产物：后端 8322 + Nginx 80 端口反代 /api，前端由 Nginx 托管
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:2873154240-hub/LL.git}"
APP_DIR="${APP_DIR:-/opt/mingxi-ai}"
DOMAIN="${DOMAIN:-_}"            # 有域名则填，如 example.com；无域名留 _（用服务器 IP）
PYTHON="${PYTHON:-python3}"

echo "==> 1/6 安装系统依赖"
apt-get update -y
apt-get install -y nginx python3-venv python3-pip curl git nodejs npm || true

echo "==> 2/6 拉取代码"
mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR" && git pull
fi
cd "$APP_DIR"

echo "==> 3/6 构建前端"
cd web
npm install --no-audit --no-fund
npm run build
cd ..

echo "==> 4/6 安装后端依赖并配置"
cd backend
${PYTHON} -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
# 如果存在 .env 则保留，否则从模板生成（生产需人工补 SECRET_KEY / SMTP）
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's/^DEV_RETURN_CODE=.*/DEV_RETURN_CODE=0/' .env
  echo "已生成 backend/.env，请编辑填写 SECRET_KEY / SMTP 后重启"
fi
cd ..

echo "==> 5/6 配置 systemd 服务"
cat > /etc/systemd/system/mingxi-ai.service <<EOF
[Unit]
Description=Mingxi AI backend
After=network.target

[Service]
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8322
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mingxi-ai
systemctl restart mingxi-ai

echo "==> 6/6 配置 Nginx"
if [ "$DOMAIN" = "_" ]; then
  SERVER_NAME="_"
else
  SERVER_NAME="$DOMAIN www.$DOMAIN"
fi
cat > /etc/nginx/sites-available/mingxi-ai <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    client_max_body_size 20m;

    root $APP_DIR/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8322;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /site/ {
        alias $APP_DIR/web/public/site/;
        try_files \$uri \$uri/ /site/index.html;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
ln -sf /etc/nginx/sites-available/mingxi-ai /etc/nginx/sites-enabled/mingxi-ai
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "=============================================="
echo "部署完成！"
if [ "$DOMAIN" = "_" ]; then
  echo "访问地址：http://<服务器公网IP>   （用你的 IP 打开）"
else
  echo "访问地址：http://$DOMAIN"
fi
echo "后端健康检查：curl http://127.0.0.1:8322/api/health"
echo ""
echo "下一步：编辑 $APP_DIR/backend/.env 填写 SECRET_KEY / SMTP 后执行："
echo "  systemctl restart mingxi-ai"
echo "（生产环境务必设置 SECRET_KEY、DEV_RETURN_CODE=0、SMTP 邮箱）"
echo "=============================================="
