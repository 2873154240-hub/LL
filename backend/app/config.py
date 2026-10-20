# -*- coding: utf-8 -*-
"""全局配置。

设计取舍：
- 不引入 pydantic-settings，配置项很少，读环境变量足够；
- 所有可调项都给默认值，保证 `uvicorn app.main:app` 直接能跑；
- 真正接 LLM 时只需设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 读取 backend/.env（若存在）。override=False：已经存在的系统环境变量优先，
# 容器/CI 里注入的配置不会被本地文件悄悄覆盖。
load_dotenv(BASE_DIR / ".env", override=False)

# --- 数据库 ---------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'app.db'}")

# --- 鉴权 -----------------------------------------------------------------
# 生产必须换掉；这里给默认值只是为了本地开箱即用
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-please-0123456789abcdef")

# 站点所有者邮箱：只有这个账号能看到并操作「站点开关」。
# 留空 = 关闭所有者功能（CLI 开关仍然可用）。
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "").strip().lower()
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "10080"))  # 7 天

# --- 计费 -----------------------------------------------------------------
# 每次 AI 研究消耗的 Token。免费额度按天清零，付费 Token 不清零。
ANALYSIS_COST = int(os.getenv("ANALYSIS_COST", "10"))
FREE_TOKENS_PER_DAY = int(os.getenv("FREE_TOKENS_PER_DAY", "50"))

# 充值定价：1 USDT = 100 Token（2026-10 用户指定）。
TOKENS_PER_USDT = int(os.getenv("TOKENS_PER_USDT", "100"))
MIN_RECHARGE_USDT = float(os.getenv("MIN_RECHARGE_USDT", "1"))
MAX_RECHARGE_USDT = float(os.getenv("MAX_RECHARGE_USDT", "10000"))

# --- 邮件验证码 -----------------------------------------------------------
# 未配置 SMTP 时，验证码会写进控制台并在接口响应里返回（仅开发模式）。
# 这样不接邮件服务也能完整跑通注册/找回密码流程。
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
CODE_TTL_SECONDS = int(os.getenv("CODE_TTL_SECONDS", "300"))
DEV_RETURN_CODE = os.getenv("DEV_RETURN_CODE", "1") == "1"

# --- LLM ------------------------------------------------------------------
# 任何 OpenAI 兼容接口都能接（DeepSeek / 通义 / 本地 vLLM ...）。
# 不配 key 时走内置规则引擎，输出结构完全一致 —— 保证无网也能演示。
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "60"))

# --- 行情 -----------------------------------------------------------------
# 行情抓取超时。本项目只使用真实行情：所有数据源都失败时接口返回 503，
# 不会退回合成数据（避免用户把假行情当成真行情）。
MARKET_TIMEOUT = float(os.getenv("MARKET_TIMEOUT", "8"))

# --- 支付（Binance Pay 商户收单）------------------------------------------
# 只有开关打开且三项凭证齐全才会走真实支付；否则保持模拟支付。
# 这里只接商户 API，不接任何个人钱包地址。
BINANCE_PAY_ENABLED = os.getenv("BINANCE_PAY_ENABLED", "0") == "1"
BINANCE_PAY_MERCHANT_ID = os.getenv("BINANCE_PAY_MERCHANT_ID", "").strip()
BINANCE_PAY_API_KEY = os.getenv("BINANCE_PAY_API_KEY", "").strip()
BINANCE_PAY_API_SECRET = os.getenv("BINANCE_PAY_API_SECRET", "").strip()
BINANCE_PAY_BASE_URL = os.getenv("BINANCE_PAY_BASE_URL", "https://bpay.binanceapi.com").rstrip("/")
BINANCE_PAY_CURRENCY = os.getenv("BINANCE_PAY_CURRENCY", "USDT").upper()
BINANCE_PAY_TIMEOUT = float(os.getenv("BINANCE_PAY_TIMEOUT", "15"))
# 可选：直接配置 Binance 的证书公钥（PEM 字符串，或 PEM 文件路径），
# 省去启动后调用证书接口。推荐用文件，避免把多行 PEM 塞进 .env。
BINANCE_PAY_CERT_PUBLIC = os.getenv("BINANCE_PAY_CERT_PUBLIC", "").strip()
BINANCE_PAY_CERT_FILE = os.getenv("BINANCE_PAY_CERT_FILE", "").strip()

# 人民币 → USDT 的结算汇率。真实上线应改成定时拉取或由财务配置。
USD_CNY_RATE = float(os.getenv("USD_CNY_RATE", "7.2"))

# 支付完成后的前端跳转地址；webhook 必须是公网 HTTPS 地址。
PAYMENT_RETURN_URL = os.getenv("PAYMENT_RETURN_URL", "http://localhost:5173/me")
PAYMENT_CANCEL_URL = os.getenv("PAYMENT_CANCEL_URL", "http://localhost:5173/me")
PAYMENT_WEBHOOK_URL = os.getenv("PAYMENT_WEBHOOK_URL", "").strip()

# --- CORS -----------------------------------------------------------------
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")
