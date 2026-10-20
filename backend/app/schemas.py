# -*- coding: utf-8 -*-
"""请求/响应模型。

原则：出参只暴露前端真正需要的字段，尤其是 users 表 —— 绝不能把
password_hash 顺手塞进响应里（FastAPI 的 from_attributes 很容易犯这个错）。
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


# ------------------------------------------------------------------ 输入


class SendCodeIn(BaseModel):
    email: EmailStr
    purpose: str = Field(default="register", pattern="^(register|reset)$")


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=64)
    code: str = Field(min_length=4, max_length=8)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordIn(BaseModel):
    email: EmailStr
    code: str
    password: str = Field(min_length=6, max_length=64)


class AnalysisIn(BaseModel):
    symbol: str = Field(min_length=2, max_length=32)
    market: str = Field(default="crypto", pattern="^(crypto)$")
    interval: str = Field(default="1h", pattern="^(15m|1h|4h|1d)$")
    model: str = "auto"


class RechargeIn(BaseModel):
    """充值时用 USDT 金额定价（对齐 clawdesk 的「最小 1 USDT、金额自填」）。

    仍保留 tokens 入参，方便旧脚本/测试按 Token 数下单；两者至少给一个。
    """
    amount_usdt: float | None = Field(default=None, ge=1, le=10000)
    tokens: int | None = Field(default=None, ge=1, le=10000000)

    @model_validator(mode="after")
    def _need_one(self):
        if self.amount_usdt is None and self.tokens is None:
            raise ValueError("请提供 amount_usdt 或 tokens")
        return self


# ------------------------------------------------------------------ 输出


class ORMBase(BaseModel):
    """所有出参都从 SQLAlchemy 模型直接转换，因此统一开 from_attributes"""
    model_config = ConfigDict(from_attributes=True)


class UserOut(ORMBase):
    id: int
    email: str
    nickname: str
    token_balance: int
    free_token_used: int
    free_token_date: str
    coins: int
    created_at: datetime
    is_owner: bool = False


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class LedgerOut(ORMBase):
    id: int
    delta: int
    balance_after: int
    reason: str
    detail: str
    created_at: datetime


class AnalysisSummary(ORMBase):
    id: int
    symbol: str
    market: str
    interval: str
    model: str
    verdict: str
    price: float
    created_at: datetime


class AnalysisOut(AnalysisSummary):
    payload: dict


class RechargeOrderOut(ORMBase):
    id: int
    tokens: int
    amount_cny: float
    amount_usdt: float
    status: str
    created_at: datetime
    paid_at: datetime | None
