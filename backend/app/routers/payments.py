# -*- coding: utf-8 -*-
"""支付渠道回调。

Webhook 是匿名接口，安全完全依赖签名验证：
- 必须用 Binance 证书公钥做 RSA-SHA256 验签；
- 只处理 PAY_SUCCESS / PAID；
- 入账走 wallet.mark_recharge_paid，天然幂等，重试不会重复加钱。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PaymentAttempt, RechargeOrder
from ..services import binance_pay, wallet

router = APIRouter(prefix="/api/payments", tags=["payments"])
log = logging.getLogger(__name__)


@router.post("/binance/webhook")
async def binance_webhook(request: Request, db: Session = Depends(get_db)):
    if not binance_pay.is_configured():
        raise HTTPException(status_code=503, detail="支付渠道未配置")

    raw_body = await request.body()
    if not binance_pay.verify_webhook(request.headers, raw_body):
        # 不要返回具体原因，避免给伪造者调试信息
        raise HTTPException(status_code=401, detail="invalid signature")

    notification = binance_pay.parse_notification(raw_body)
    if notification is None:
        # 非支付成功事件（关单/失败等）直接确认，避免 Binance 反复重试
        return PlainTextResponse("SUCCESS")

    attempt = db.scalar(
        select(PaymentAttempt).where(
            PaymentAttempt.merchant_trade_no == notification["merchant_trade_no"]
        )
    )
    if attempt is None:
        # 签名有效但订单不在本地：可能是别的环境/已清理的订单。
        # 记录日志并确认，防止无限重试；人工对账时可据此排查。
        log.warning(
            "Binance Pay webhook: unknown merchantTradeNo=%s",
            notification["merchant_trade_no"],
        )
        return PlainTextResponse("SUCCESS")

    order = db.get(RechargeOrder, attempt.order_id)
    if order is None:
        log.error(
            "Binance Pay webhook: order %s missing (trade_no=%s)",
            attempt.order_id,
            notification["merchant_trade_no"],
        )
        return PlainTextResponse("SUCCESS")

    try:
        credited = wallet.mark_recharge_paid(
            db,
            order,
            f"Binance Pay {notification['merchant_trade_no']}",
        )
        db.commit()
        log.info(
            "Binance Pay webhook: order=%s trade_no=%s credited=%s txn=%s amount=%s %s",
            order.id,
            notification["merchant_trade_no"],
            credited,
            notification.get("transaction_id"),
            notification.get("pay_amount"),
            notification.get("currency"),
        )
    except Exception:
        db.rollback()
        log.exception("Binance Pay webhook: failed to credit order %s", order.id)
        # 返回 500 让 Binance 重试；绝不能吞掉入账失败
        raise HTTPException(status_code=500, detail="credit failed")

    return PlainTextResponse("SUCCESS")
