# -*- coding: utf-8 -*-
"""支付链路冒烟：模拟支付、Binance Pay 验签、Webhook 入账与幂等。

不访问 Binance 网络：RSA 密钥对在本地生成，只验证我们自己的签名逻辑。
真实下单还需要商户后台的 API Key/Secret，跑这个脚本不需要。
"""
import base64
import json
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.main import app
from app.db import SessionLocal
from app.models import PaymentAttempt, RechargeOrder, TokenLedger, User
from app.services import binance_pay

client = TestClient(app)
email = f"paytest-{int(time.time())}@example.com"


def register() -> str:
    code = client.post(
        "/api/auth/send-code", json={"email": email, "purpose": "register"}
    ).json()["dev_code"]
    r = client.post(
        "/api/auth/register",
        json={"email": email, "password": "demo123456", "code": code},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def cleanup(user_id: int) -> None:
    db = SessionLocal()
    try:
        order_ids = [
            row[0]
            for row in db.execute(
                select(RechargeOrder.id).where(RechargeOrder.user_id == user_id)
            )
        ]
        if order_ids:
            db.execute(delete(PaymentAttempt).where(PaymentAttempt.order_id.in_(order_ids)))
            db.execute(delete(RechargeOrder).where(RechargeOrder.id.in_(order_ids)))
        db.execute(delete(TokenLedger).where(TokenLedger.user_id == user_id))
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
    finally:
        db.close()


def main() -> None:
    token = register()
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()
    user_id = me["id"]

    try:
        # 1) 默认配置下是模拟支付；定价按 USDT 自填金额（对齐 clawdesk）
        summary = client.get("/api/user/summary", headers=headers).json()
        assert summary["payment"]["provider"] == "demo", summary["payment"]
        assert summary["pricing"]["min_usdt"] == 1
        assert summary["pricing"]["tokens_per_usdt"] == 100

        # 低于最小金额直接被请求模型拦掉
        r = client.post("/api/user/recharge", json={"amount_usdt": 0.5}, headers=headers)
        assert r.status_code == 422, (r.status_code, r.text)

        created = client.post(
            "/api/user/recharge", json={"amount_usdt": 2.5}, headers=headers
        ).json()
        assert created["payment"] is None, created
        order_id = created["order"]["id"]
        assert created["order"]["tokens"] == 250, created["order"]
        assert created["order"]["amount_usdt"] == 2.5, created["order"]
        assert client.post(
            f"/api/user/recharge/{order_id}/pay", headers=headers
        ).json()["ok"]
        assert client.post(
            f"/api/user/recharge/{order_id}/pay", headers=headers
        ).json()["already_paid"]
        print("模拟支付: OK")

        # 2) 打开真实支付配置，准备本地 RSA 证书
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_pem = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        binance_pay.BINANCE_PAY_ENABLED = True
        binance_pay.BINANCE_PAY_MERCHANT_ID = "test-merchant"
        binance_pay.BINANCE_PAY_API_KEY = "test-api-key"
        binance_pay.BINANCE_PAY_API_SECRET = "test-api-secret"
        binance_pay.BINANCE_PAY_CERT_PUBLIC = public_pem
        binance_pay._CERT_CACHE.clear()
        assert binance_pay.is_configured()

        # 3) 真实模式下模拟支付入口必须被禁用
        db = SessionLocal()
        try:
            order = RechargeOrder(user_id=user_id, tokens=500, amount_cny=5.0, status="pending")
            db.add(order)
            db.commit()
            db.refresh(order)
            real_order_id = order.id
        finally:
            db.close()
        r = client.post(f"/api/user/recharge/{real_order_id}/pay", headers=headers)
        assert r.status_code == 403, (r.status_code, r.text)
        print("真实模式禁用 /pay: OK")

        # 4) 构造一笔渠道订单，发送已签名的 Webhook
        db = SessionLocal()
        try:
            order = db.get(RechargeOrder, real_order_id)
            trade_no = f"MX{order.id}"
            db.add(
                PaymentAttempt(
                    order_id=order.id,
                    provider="binance_pay",
                    merchant_trade_no=trade_no,
                    checkout_url="https://example.com/checkout",
                )
            )
            db.commit()
            db.refresh(order)
        finally:
            db.close()

        body = json.dumps(
            {
                "bizType": "PAY",
                "bizStatus": "PAY_SUCCESS",
                "data": {
                    "merchantTradeNo": trade_no,
                    "orderStatus": "PAID",
                    "transactionId": "TEST-TXN-1",
                    "payAmount": "0.69",
                    "currency": "USDT",
                },
            },
            separators=(",", ":"),
        ).encode()

        timestamp = str(int(time.time() * 1000))
        nonce = "a" * 32
        signature = private_key.sign(
            f"{timestamp}\n{nonce}\n{body.decode()}\n".encode(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        webhook_headers = {
            "Content-Type": "application/json",
            "BinancePay-Timestamp": timestamp,
            "BinancePay-Nonce": nonce,
            "BinancePay-Certificate-SN": "test-cert-sn",
            "BinancePay-Signature": base64.b64encode(signature).decode(),
        }

        r = client.post(
            "/api/payments/binance/webhook", content=body, headers=webhook_headers
        )
        assert r.status_code == 200 and r.text == "SUCCESS", (r.status_code, r.text)

        db = SessionLocal()
        try:
            user = db.get(User, user_id)
            order = db.get(RechargeOrder, real_order_id)
            assert order.status == "paid"
            # 前面模拟支付已经入了 250，这里再加 500
            assert user.token_balance == 750
        finally:
            db.close()
        print("Webhook 验签与入账: OK")

        # 5) 重放同一通知不能重复加钱
        r = client.post(
            "/api/payments/binance/webhook", content=body, headers=webhook_headers
        )
        assert r.text == "SUCCESS"
        db = SessionLocal()
        try:
            assert db.get(User, user_id).token_balance == 750
        finally:
            db.close()
        print("Webhook 幂等: OK")

        # 6) 篡改内容后签名校验必须失败
        bad_body = body.replace(b"TEST-TXN-1", b"TEST-TXN-2")
        r = client.post(
            "/api/payments/binance/webhook", content=bad_body, headers=webhook_headers
        )
        assert r.status_code == 401, (r.status_code, r.text)
        print("篡改拒绝: OK")

        print("ALL OK")
    finally:
        cleanup(user_id)


if __name__ == "__main__":
    main()
