# -*- coding: utf-8 -*-
"""账户余额、Token 流水、充值、概览。

充值采用钱包转账模式：创建订单后向收款地址转 USDT，确认到账即入账
（调用 `/recharge/{id}/pay`，幂等，重复调用不会重复加钱）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import (
    ANALYSIS_COST,
    FREE_TOKENS_PER_DAY,
    MAX_RECHARGE_USDT,
    MIN_RECHARGE_USDT,
    TOKENS_PER_USDT,
    USD_CNY_RATE,
)
from ..db import get_db
from ..deps import get_current_user
from ..models import Analysis, RechargeOrder, TokenLedger, User
from ..schemas import LedgerOut, RechargeIn, RechargeOrderOut, UserOut
from ..services import wallet

router = APIRouter(prefix="/api/user", tags=["user"])

# 旧版按人民币定价的展示字段，仅为兼容保留；真实下单以 TOKENS_PER_USDT 为准。
TOKENS_PER_CNY = 100


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    wallet.reset_daily(user)
    db.commit()
    total_runs = db.scalar(
        select(func.count()).select_from(Analysis).where(Analysis.user_id == user.id)
    ) or 0
    return {
        "user": UserOut.model_validate(user),
        "quota": {
            "free_remaining": wallet.free_remaining(user),
            "free_per_day": FREE_TOKENS_PER_DAY,
            "paid_balance": user.token_balance,
            "available": wallet.available(user),
            "cost_per_run": ANALYSIS_COST,
        },
        "total_runs": total_runs,
        "pricing": {
            "tokens_per_cny": TOKENS_PER_CNY,
            "tokens_per_usdt": TOKENS_PER_USDT,
            "min_usdt": MIN_RECHARGE_USDT,
            "max_usdt": MAX_RECHARGE_USDT,
            "usd_cny_rate": USD_CNY_RATE,
        },
        "payment": {
            "provider": "wallet",
            "currency": "USDT",
            "usd_cny_rate": USD_CNY_RATE,
        },
    }


@router.get("/ledger")
def ledger(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(TokenLedger)
        .where(TokenLedger.user_id == user.id)
        .order_by(TokenLedger.created_at.desc())
        .limit(max(1, min(limit, 200)))
    ).all()
    return {"items": [LedgerOut.model_validate(r) for r in rows]}


@router.post("/recharge")
def create_order(
    body: RechargeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 定价以 USDT 为准（对齐 clawdesk：最小 1 USDT、金额自填）。
    # 仍兼容旧的 tokens 入参，按同一汇率折算。
    if body.amount_usdt is not None:
        amount_usdt = round(body.amount_usdt, 2)
    else:
        amount_usdt = round(body.tokens / TOKENS_PER_USDT, 2)
    if amount_usdt < MIN_RECHARGE_USDT:
        raise HTTPException(400, f"最小充值金额为 {MIN_RECHARGE_USDT:g} USDT")
    if amount_usdt > MAX_RECHARGE_USDT:
        raise HTTPException(400, f"单笔充值不能超过 {MAX_RECHARGE_USDT:g} USDT")

    tokens = max(1, round(amount_usdt * TOKENS_PER_USDT))
    order = RechargeOrder(
        user_id=user.id,
        tokens=tokens,
        amount_cny=round(amount_usdt * USD_CNY_RATE, 2),
        status="pending",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    return {
        "order": RechargeOrderOut.model_validate(order),
        "payment": None,
        "pay_hint": "请向收款地址转对应 USDT，确认到账后 Token 自动增加",
    }


@router.post("/recharge/{order_id}/pay")
def pay_order(
    order_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = db.get(RechargeOrder, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, "订单不存在")
    if order.status == "paid":
        # 幂等：重复确认不能重复加钱
        return {"ok": True, "already_paid": True}

    wallet.mark_recharge_paid(db, order)
    db.commit()
    db.refresh(user)
    return {
        "ok": True,
        "tokens_added": order.tokens,
        "balance": wallet.available(user),
    }


@router.get("/recharge/orders")
def orders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(RechargeOrder)
        .where(RechargeOrder.user_id == user.id)
        .order_by(RechargeOrder.created_at.desc())
        .limit(50)
    ).all()
    return {"items": [RechargeOrderOut.model_validate(r) for r in rows]}
