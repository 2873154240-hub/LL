# 明析 AI · 决策研究台

对标 [clawdesk.cc](https://clawdesk.cc/) 的标的 AI 研究站：选择标的，由 AI 输出**方向结论、执行计划、关键价位、反向预案、事件合约到期判断**。完整全栈实现，开箱即跑，不依赖任何付费 API。

> ⚠️ 本项目是**教学/演示性质**的产品原型。行情来自公开的真实数据源（见下），支付为模拟支付，输出不构成投资建议。

---

## 功能

| 模块 | 内容 |
|---|---|
| 研究台 | 动态目录覆盖 Gate.io 全部 USDT 现货交易对（约 1600+ 个，按 24H 成交额排序），含中文名与 16 类分类筛选；4 个周期（15m/1h/4h/1d）；实时行情、搜索、一键研究 |
| 决策卡 | 方向（做多/做空/等待/回避）、信心拆解（技术/资金/情绪/结构/形态）、执行计划（入场区间/止损/止盈/杠杆/仓位/盈亏比/单笔风险）、关键支撑阻力、周期共振、反向预案、事件合约、风险提示、技术快照 |
| 账户体系 | 邮箱验证码注册、JWT 登录、找回/修改密码、每日免费 Token、付费余额、Token 流水 |
| 计费 | 每次研究扣 10 Token（优先扣免费额度），研究失败自动退款；充值按 USDT 自填金额（最小 1 USDT，1 USDT = 100 Token），默认模拟支付、可接 Binance Pay |
| 历史记录 | 保存生成当时的完整快照，可搜索、查看、删除、清空 |

## 技术栈

- **后端**：FastAPI · SQLAlchemy 2.0 · SQLite · PyJWT · httpx
- **前端**：React 19 · React Router 7 · Vite 6 · 原生 CSS（无 UI 框架）
- **纯 HTML 版前端**：`web/public/site/`（HTML + CSS + 原生 JS，无构建步骤、无框架依赖）
- **行情（全部真实）**：报价与 K 线用 **Gate.io**（Binance 公共接口作备用）。无合成数据降级，上游全挂时返回 503
- **研究引擎**：本地规则引擎（指标 + 打分 + 计划生成）；配置 LLM 后可接入任意 OpenAI 兼容接口

## 目录结构

```
ai-predict-site/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI 入口
│   │   ├── config.py            环境变量与默认值
│   │   ├── models.py            SQLAlchemy 模型
│   │   ├── schemas.py           Pydantic 出入参
│   │   ├── security.py          密码哈希 / JWT / 验证码
│   │   ├── routers/             auth · market · analysis · billing
│   │   └── services/            market_data · indicators · research · wallet · mailer
│   ├── data/app.db              SQLite（首次启动自动创建）
│   ├── requirements.txt
│   └── smoke_test.py            后端端到端冒烟
└── web/
    ├── src/
    │   ├── pages/               研究台 / 历史 / 我的 / 登录 / 注册
    │   ├── components/          Layout · DecisionCard · Sparkline
    │   ├── api.js               请求封装与格式化
    │   ├── auth.jsx             登录态 Context
    │   └── styles.css           设计系统
    ├── public/site/             纯 HTML 版（index.html · app.js · styles.css）
    ├── vite.config.js           /api 代理到 8322
    └── package.json
```

## 快速开始

### 1. 后端（端口 8322）

```bash
cd backend

# 首次：创建虚拟环境并安装依赖
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

# 启动
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8322
```

- Swagger：<http://127.0.0.1:8322/docs>
- 健康检查：<http://127.0.0.1:8322/api/health>

可选：跑一遍端到端冒烟（不启动服务器，直接 TestClient）：

```bash
.venv\Scripts\python.exe smoke_test.py
```

### 2. 前端（端口 5173）

```bash
cd web
npm install
npm run dev
```

打开 <http://localhost:5173>。Vite 已把 `/api` 代理到 `http://127.0.0.1:8322`。

### 3. 纯 HTML 版本（无构建、无 React）

如果只想改 HTML/CSS/JS，或不想装 Node 依赖，直接用这个版本：

- 后端启动后访问 <http://127.0.0.1:8322/site/>（FastAPI 已挂载静态目录）；
- 或在 `npm run dev` 期间访问 <http://localhost:5173/site/>。

文件只有三个，全部可直接编辑：

| 文件 | 内容 |
|---|---|
| `web/public/site/index.html` | 页面骨架：顶栏、研究台、历史、我的、登录/注册、维护页 |
| `web/public/site/styles.css` | 样式（与 React 版共用同一套设计 token） |
| `web/public/site/app.js` | 路由、接口调用、行情轮询、决策卡渲染、充值/历史逻辑 |

路由是 hash 形式（`#/`、`#/history`、`#/me`、`#/login`、`#/register`），因此可以放在任意静态目录，不需要服务端 rewrite。接口仍走同源 `/api`，登录态沿用 `localStorage.mx_token`，与 React 版可以互相登录。

`npm run build` 会把整个目录复制到 `dist/site/`。

### 4. 注册体验

1. 打开 `/register`，填邮箱 → 点「获取验证码」。
2. **未配置 SMTP 时**，验证码会自动填入并在页面提示（开发模式）。
3. 设置密码完成注册，自动获得每日 50 个免费 Token。
4. 回到研究台，选标的 → 「开始 AI 研究」，每次消耗 10 Token。

## 环境变量

全部有默认值，**不配置也能跑**。需要覆盖时把 `backend/.env.example` 复制为 `backend/.env` 修改即可（启动时自动加载；已存在的系统环境变量优先级更高）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite:///backend/data/app.db` | 数据库连接串 |
| `SECRET_KEY` | 内置开发密钥 | **生产必须替换** |
| `TOKEN_EXPIRE_MINUTES` | `10080` | JWT 有效期（7 天） |
| `ANALYSIS_COST` | `10` | 单次研究消耗 Token |
| `FREE_TOKENS_PER_DAY` | `50` | 每日免费额度 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | 空 / 465 | 不配则验证码走开发模式 |
| `DEV_RETURN_CODE` | `1` | 未发信时是否在接口返回验证码（生产置 0） |
| `CODE_TTL_SECONDS` | `300` | 验证码有效期 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 空 / OpenAI / `gpt-4o-mini` | 配置后启用 LLM 润色；空则用规则引擎 |
| `MARKET_TIMEOUT` | `8` | 行情请求超时（秒） |
| `CORS_ORIGINS` | `http://localhost:5173,...` | 允许的前端来源，逗号分隔 |
| `BINANCE_PAY_ENABLED` | `0` | 设为 `1` 且凭证齐全时启用 Binance Pay 真实收款 |
| `BINANCE_PAY_MERCHANT_ID` / `BINANCE_PAY_API_KEY` / `BINANCE_PAY_API_SECRET` | 空 | Binance Pay 商户凭证，**只放 `.env`，不要提交或发到聊天里** |
| `BINANCE_PAY_CERT_FILE` | 空 | 可选，Binance 证书公钥 PEM 文件路径；留空则运行时拉取并缓存 |
| `TOKENS_PER_USDT` | `100` | 充值定价：1 USDT 兑换的 Token 数 |
| `MIN_RECHARGE_USDT` / `MAX_RECHARGE_USDT` | `1` / `10000` | 单笔充值金额区间（USDT） |
| `USD_CNY_RATE` | `7.2` | USDT → 人民币的展示汇率（订单同时记录人民币金额） |
| `PAYMENT_RETURN_URL` / `PAYMENT_CANCEL_URL` | `http://localhost:5173/me` | 支付完成/取消后的前端跳转地址 |
| `PAYMENT_WEBHOOK_URL` | 空 | 公网 HTTPS 回调地址；也可在 Binance 商户后台配置 |

## API 一览

统一前缀 `/api`，除注册/登录/验证码外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/send-code` | 发送验证码（register / reset） |
| POST | `/auth/register` | 注册 |
| POST | `/auth/login` | 登录 |
| GET | `/auth/me` | 当前用户 |
| POST | `/auth/reset-password` | 验证码重置密码 |
| GET | `/market/symbols` | 标的目录（crypto） |
| GET | `/market/models` | 可用研究模型 |
| GET | `/market/ticker` | 批量实时报价（前端 3s 轮询，服务端 2s 缓存） |
| GET | `/market/overview` | 单个标的行情概览 + K 线 |
| GET | `/market/quotes` | 标的列表涨跌快照 |
| GET | `/analysis/cost` | 单次研究成本 |
| POST | `/analysis/run` | 执行研究并保存 |
| GET | `/analysis/history` | 历史记录（搜索/分页） |
| GET | `/analysis/{id}` | 记录详情（完整快照） |
| DELETE | `/analysis/{id}` | 删除单条 |
| DELETE | `/analysis` | 清空历史 |
| GET | `/user/summary` | 余额、额度、累计研究 |
| GET | `/user/ledger` | Token 流水 |
| POST | `/user/recharge` | 创建充值订单 |
| POST | `/user/recharge/{id}/pay` | 模拟支付（仅未配置真实渠道时可用，幂等） |
| POST | `/user/recharge/{id}/sync` | 主动向 Binance Pay 查单并补入账 |
| GET | `/user/recharge/orders` | 充值订单 |
| POST | `/payments/binance/webhook` | Binance Pay 异步通知（RSA 验签，无需登录） |

## 实现说明（重要）

- **行情全部真实、无降级**：报价与 K 线走 Gate.io 公开行情（24h 统计），Gate 不可达时自动切 Binance；两者都失败则接口返回 503——**绝不伪造曲线**。决策卡和列表都会标注实际来源与报价时间。
- **币种目录是动态的**：`/market/symbols` 直接读取 Gate 全部 USDT 现货交易对并按 24H 成交额排序，自动剔除杠杆代币（3L/3S/5L/5S）、稳定币和非法代码；常见币种配中文名与分类，长尾币种回退显示代码。行情快照用一次全市场请求批量取回，不按币种逐个请求。
- **实时性**：前端研究台每 3 秒批量拉取一次 `/market/ticker`（顶栏 BTC 每 5 秒），服务端报价缓存 2 秒、K 线缓存 20 秒，既保证数字持续跳动又不把上游打爆；页面切到后台时暂停轮询。加密市场 7×24，不存在休市。价格变化会闪绿色/红色，实时面板的折线右端随最新价一起移动。
- **研究引擎**：先算 MA/EMA、RSI、MACD、ATR、ADX、摆动高低点、量比、30 日分位，再按五个维度加权打分，最后由规则生成方向、执行计划与事件合约。没有 LLM Key 时全流程可复现。
- **充值定价**：服务端按 USDT 定价（默认 1 USDT = 100 Token，单笔 1–10000 USDT），前端可自填金额或选 1/5/10/50 快捷档；订单同时记录 USDT 与按 `USD_CNY_RATE` 折算的人民币金额。请求体传 `amount_usdt`，旧的 `tokens` 入参仍兼容。
- **支付有两种模式**：默认是模拟支付（`POST /user/recharge/{id}/pay` 即视为成功）。在 `backend/.env` 配好 Binance Pay 的商户号、API Key、API Secret 并把 `BINANCE_PAY_ENABLED=1` 后，创建订单会返回 Binance Pay 收银台地址；入账只认已验签的 Webhook 或主动查单，模拟支付入口同时被禁用。Webhook 用 Binance 证书公钥做 RSA-SHA256 验签，入账幂等，重试不会重复加钱。
- **不收个人钱包地址**：本项目只接持牌支付渠道的商户收单，不展示、不生成、不监听任何个人 USDT 地址，也不提供「我付了 → 人工加余额」的入口。请勿把个人钱包地址写进充值流程。
- **站点开关（一个人控制）**：`backend/.env` 的 `OWNER_EMAIL` 指定唯一所有者。所有者登录后在「我的」页看到开关；关站后除健康检查、站点状态、登录外，所有 API 返回 503（`code=site_disabled`），前端自动显示维护页。没有登录条件时也可在 `backend/` 下执行 `python site_switch.py off|on|status`，改完立即生效，不需要重启。
- **风控边界**：系统只输出决策边界，不连接交易所、不自动下单。
- **单进程假设**：邮件限流与部分状态依赖数据库，可直接多进程序跑；但没有引入消息队列，所有研究同步完成。

## 已验证

- `backend/smoke_test.py`：注册 → 行情 → 研究 → 历史 → 充值，全部通过。
- 浏览器全流程（Chrome）：注册 → 研究出卡 → 历史详情 → 充值到账，无 console error、无 4xx/5xx。
- `npm run build` 通过。

## 免责声明

本项目仅用于技术学习与产品原型演示。行情数据来自公开第三方接口，可能存在延迟或中断；AI 结论由规则/模型生成，**不构成任何投资建议**。使用者应自行承担相关风险。
