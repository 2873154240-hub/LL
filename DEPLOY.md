# 生产部署指南（Zeabur / PaaS 单容器）

本文件指导把「明析 AI」正式上线到公网。项目已内置单容器部署能力：
一个 Dockerfile 同时构建前端并把产物交给后端托管，PaaS 平台一键运行即可。

---

## 1. 部署方式概览

- **技术形态**：单容器。后端 FastAPI 直接托管前端构建产物 `web/dist` + `/api` 接口。
- **推荐平台**：Zeabur（国内访问相对友好、提供免费子域名、无需自购服务器）。
- **无域名怎么办**：Zeabur 会给你 `xxx.zeabur.app` 免费子域名，可直接对外访问；以后想换自己的域名随时可绑。

---

## 2. Zeabur 部署步骤

1. 打开 <https://zeabur.com>，注册 / 登录（可用 GitHub 或邮箱）。
2. 创建新项目（Project）。
3. 添加服务（Service）→ 选择「从源码部署 / Git 或本地目录」：
   - 若走 Git：把本项目推到 GitHub，选择仓库，Zeabur 会自动识别根目录 `Dockerfile`。
   - 若走 CLI：安装 `zeabur` CLI 后 `zeabur deploy` 并选择项目。
4. 平台会自动用根目录 `Dockerfile` 构建（先 npm 构建前端，再跑后端）。
5. 在服务「Variables」里配置生产环境变量（见下节）。
6. 服务会分配公网域名（`*.zeabur.app`），直接打开即可访问。

---

## 3. 必须配置的生产环境变量

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
