# -*- coding: utf-8 -*-
"""数据表定义。

命名与产品概念一一对应：
- users          账号、Token 余额、金币
- analyses       每次 AI 研究的完整决策卡片（JSON，便于结构演进）
- token_ledger   每一次 Token 增减的流水，账必须能对平
- recharge_orders 充值订单（本项目为模拟支付，不接真实支付渠道）
- email_codes    邮箱验证码
"""
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    """统一存 naive UTC，避免 SQLite 时区读写不一致"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(64), default="")
    avatar_seed: Mapped[str] = mapped_column(String(32), default="")

    token_balance: Mapped[int] = mapped_column(Integer, default=0)   # 付费 Token
    free_token_used: Mapped[int] = mapped_column(Integer, default=0)  # 今日已用免费额度
    free_token_date: Mapped[str] = mapped_column(String(10), default="")  # YYYY-MM-DD
    coins: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def is_owner(self) -> bool:
        """只有 OWNER_EMAIL 对应的账号是站点所有者。"""
        from .config import OWNER_EMAIL

        return bool(OWNER_EMAIL) and self.email.lower() == OWNER_EMAIL


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    market: Mapped[str] = mapped_column(String(16))          # us / crypto
    interval: Mapped[str] = mapped_column(String(8))
    model: Mapped[str] = mapped_column(String(64))
    verdict: Mapped[str] = mapped_column(String(16))         # long / short / wait / avoid
    price: Mapped[float] = mapped_column(Float, default=0.0)
    payload: Mapped[dict] = mapped_column(JSON)              # 完整决策卡片
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class TokenLedger(Base):
    __tablename__ = "token_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)              # 正为入账，负为消耗
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(64))
    detail: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RechargeOrder(Base):
    __tablename__ = "recharge_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    tokens: Mapped[int] = mapped_column(Integer)
    amount_cny: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/paid/expired
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    @property
    def amount_usdt(self) -> float:
        """按当前结算汇率折算的 USDT 金额，供前端展示。"""
        from .config import USD_CNY_RATE

        return round(self.amount_cny / USD_CNY_RATE, 2)


class PaymentAttempt(Base):
    """真实支付渠道的订单映射。

    单独建表而不是给 recharge_orders 加列：SQLite 的 create_all 不会给
    已有表补字段，新表可以随服务启动自动创建，不需要手写迁移。
    """
    __tablename__ = "payment_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("recharge_orders.id"), index=True)
    provider: Mapped[str] = mapped_column(String(32), default="binance_pay")
    merchant_trade_no: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    checkout_url: Mapped[str] = mapped_column(Text, default="")
    qr_content: Mapped[str] = mapped_column(Text, default="")
    qrcode_link: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EmailCode(Base):
    __tablename__ = "email_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code: Mapped[str] = mapped_column(String(8))
    purpose: Mapped[str] = mapped_column(String(32))  # register / reset
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
