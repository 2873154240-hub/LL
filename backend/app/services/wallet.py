# -*- coding: utf-8 -*-
"""Token 钱包：免费额度按天重置 + 付费余额 + 流水。

消耗顺序是「先免费、后付费」：
用户当天的免费额度还没用完就绝不动付费余额，这是对用户最有利的规则，
也避免了「充了钱反而先扣钱」的投诉。
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import FREE_TOKENS_PER_DAY
from ..models import RechargeOrder, TokenLedger, User, utcnow


class InsufficientTokens(HTTPException):
    def __init__(self, need: int, have: int):
        super().__init__(status_code=402, detail=f"Token 不足：本次需要 {need}，当前可用 {have}")


def reset_daily(user: User) -> None:
    today = date.today().isoformat()
    if user.free_token_date != today:
        user.free_token_date = today
        user.free_token_used = 0


def free_remaining(user: User) -> int:
    reset_daily(user)
    return max(0, FREE_TOKENS_PER_DAY - user.free_token_used)


def available(user: User) -> int:
    return free_remaining(user) + user.token_balance


def consume(db: Session, user: User, amount: int, reason: str, detail: str = "") -> dict:
    reset_daily(user)
    have = available(user)
    if have < amount:
        raise InsufficientTokens(amount, have)

    use_free = min(free_remaining(user), amount)
    use_paid = amount - use_free

    user.free_token_used += use_free
    user.token_balance -= use_paid

    ledger = TokenLedger(
        user_id=user.id,
        delta=-amount,
        balance_after=available(user),
        reason=reason,
        detail=detail,
    )
    db.add(ledger)
    db.flush()
    return {"charged": amount, "free": use_free, "paid": use_paid, "ledger_id": ledger.id}


def grant(db: Session, user: User, amount: int, reason: str, detail: str = "") -> TokenLedger:
    user.token_balance += amount
    ledger = TokenLedger(
        user_id=user.id,
        delta=amount,
        balance_after=available(user),
        reason=reason,
        detail=detail,
    )
    db.add(ledger)
    db.flush()
    return ledger


def mark_recharge_paid(db: Session, order: RechargeOrder, detail: str = "") -> bool:
    """把充值订单置为已支付并入账。返回 True 表示本次真的入账了。

    幂等：已支付的订单直接返回 False，防止 Webhook 重试/查单轮询重复加钱。
    调用方负责 commit。
    """
    if order.status == "paid":
        return False
    user = db.get(User, order.user_id)
    if user is None:
        raise ValueError(f"订单 #{order.id} 对应的用户不存在")
    order.status = "paid"
    order.paid_at = utcnow()
    grant(db, user, order.tokens, "充值", detail or f"订单 #{order.id}")
    return True
