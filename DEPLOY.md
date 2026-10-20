# 生产部署指南（国内云服务器为主）

本文件指导把「明析 AI」正式上线到公网，供国内用户访问。**推荐方案是国内云服务器原生部署**（Nginx + uvicorn + systemd），访问快、可控、可长期运营。仓库同时保留了 Dockerfile（供 Fly.io 等境外 PaaS 使用）。

> ⚠️ 说明：Zeabur 已于 2026 年宣布停止运营（2026-12-31 全部停运、不再接受新注册），不要再用。

---

## 1. 部署方式概览

- **推荐（国内访问最快）**：国内云服务器（阿里云/腾讯云轻量应用服务器）+ Nginx 托管前端 + systemd 守护后端。
- **备选（境外 PaaS）**：Fly.io 等能跑 Docker 容器的平台，用根目录 `Dockerfile` 一键部署；但服务器在境外，国内访问偏慢。
- **代码托管**：已推到 GitHub `2873154240-hub/LL`，服务器从 GitHub 拉取。

---

## 2. 国内云服务器部署步骤

### 2.1 购买服务器

- 推荐 **腾讯云轻量应用服务器 / 阿里云轻量应用服务器**，2核2G 或 2核4G，Ubuntu 22.04 或 Debian 12。
- 价格约 ¥30–100/月（新用户常有折扣）。地域选**离用户近的城市**（如你在佛山/肇庆，可选广州/深圳）。
- 购买后在安全组/防火墙放行 **80（HTTP）** 和 **22（SSH）** 端口（后端 8322 只在内网监听，不需对外）。

### 2.2 一键部署

服务器上执行（需 root 或 sudo，脚本已备好并随仓库推送）：

```bash
# 首次：clone 仓库并运行部署脚本
sudo apt-get update && sudo apt-get install -y git
git clone git@github.com:2873154240-hub/LL.git /opt/mingxi-ai
cd /opt/mingxi-ai
sudo bash deploy_server.sh
```

> 服务器访问 GitHub 需在服务器上配置 SSH 密钥并加到 GitHub（与本地做法相同，用 `ssh.github.com:443`）。

脚本会自动完成：装依赖 → 构建前端 → 装后端 → 配置 systemd + Nginx → 启动。

### 2.3 上线后必做

部署脚本会在首次运行时从模板生成 `backend/.env`（`DEV_RETURN_CODE=0` 已默认）。**务必编辑 `/opt/mingxi-ai/backend/.env` 填写：**

| 变量 | 要求 |
|---|---|
| `SECRET_KEY` | 一长串随机字符串（**必须换**） |
| `SMTP_HOST/PORT/USER/PASSWORD` | 你的 QQ 邮箱 + 授权码（真实发验证码） |
| `OWNER_EMAIL` | `2873154240@qq.com` |

改完执行 `systemctl restart mingxi-ai` 生效。

### 2.4 配置域名 + HTTPS（可选但推荐）

有域名后：
- 把域名 A 记录指向服务器公网 IP；
- 用 certbot 申请免费 SSL：`sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d 你的域名`；
- 脚本里 `DOMAIN` 变量已预留，改后重跑或手动改 Nginx server_name。

---

## 3. 必须配置的生产环境变量（通用）


在 Zeabur 服务 Variables 中设置以下项（**不要**把 `backend/.env` 提交或打包进镜像，
PaaS 用平台变量注入；代码 `load_dotenv(override=False)` 已保证平台变量优先）。

| 变量 | 生产建议值 | 说明 |
|---|---|---|
| `SECRET_KEY` | 一长串随机字符串 | **必须替换**内置开发密钥，否则任何人可伪造登录态 |
| `DEV_RETURN_CODE` | `0` | **必须设为 0**：禁止验证码回显在接口里（否则注册等于没验证邮箱） |
| `OWNER_EMAIL` | 你的邮箱 | 设置站点所有者，可在「我的」页看到站点开关 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | 你的邮箱服务 | 真实发送注册验证码 |
| `FREE_TOKENS_PER_DAY` | `20` | 每日免费额度（按你的要求已设为 20） |
| `CORS_ORIGINS` | 你的正式域名（如 `https://xxx.zeabur.app`） | 允许的前端来源；若前端后端同域可留默认也无妨 |
| `ANALYSIS_COST` | `10` | 单次研究消耗 |
| `TOKENS_PER_USDT` / `MIN_RECHARGE_USDT` / `MAX_RECHARGE_USDT` | `100` / `1` / `10000` | 充值定价（按你的要求） |
| `USD_CNY_RATE` | `7.2` | 充值折合人民币展示汇率 |

> 其它变量（LLM、行情、Binance Pay 等）都有默认值，不配也能跑；接 LLM 才需 `LLM_API_KEY`。

---

## 4. 上线前安全检查（重要）

你的站含 **钱包地址、充值、邮箱验证码**，暴露公网前请务必：

1. **`DEV_RETURN_CODE=0`** —— 否则验证码会随接口返回，等于不设防注册。
2. **`SECRET_KEY` 用强随机串** —— 不能是内置开发密钥。
3. **充值目前是"确认到账即入账"（钱包转账演示）**：
   - 代码里 `POST /user/recharge/{id}/pay` 点击即入账。上线给真实用户用前，
     必须改为「链上核验」或「人工审核」后再入账，否则等于免费送 Token。
   - 这是当前最大的资金风险点，务必先想清楚。
4. **邮箱发件源是你的 QQ 邮箱**：公网用户注册会消耗你的发信额度，注意被滥用。

---

## 5. 本地复现 / 验证（无 Docker 时）

本机没 Docker 时，可用本地进程模拟单容器行为：

```bash
# 1. 构建前端
cd web && npm run build

# 2. 启动后端（后端会自动托管 web/dist）
cd ../backend && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8322
```

打开 <http://127.0.0.1:8322/> 应看到 React 前端；<http://127.0.0.1:8322/api/health> 应返回 JSON。

---

## 6. 上线后核对清单

- [ ] 打开公网域名，首页正常、行情正常
- [ ] 注册新账号能收到真实邮件验证码（SMTP 生效）
- [ ] 验证码不回显（`DEV_RETURN_CODE=0`）
- [ ] 研究一次能出决策卡、Token 正确扣费
- [ ] 充值「确认到账」能入账（钱包转账演示）
- [ ] HTTPS 正常（Zeabur 默认提供）
- [ ] 站点开关可用（`OWNER_EMAIL` 登录后「我的」页）

---

## 7. 说明与边界

- SQLite 单文件数据库，适合单实例；若将来并发大、要多副本，需换 PostgreSQL 并配 `DATABASE_URL`。
- 数据库持久化：Zeabur 默认容器重启会丢数据，需为服务挂载持久卷（Volume）到
  `backend/data`，否则账号/余额重启即丢失。
- 纯 HTML 版（`/site`）仍保留，不影响。
