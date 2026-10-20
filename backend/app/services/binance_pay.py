# -*- coding: utf-8 -*-
"""Binance Pay 商户收单接入。

边界（重要）：
- 只调用 Binance Pay 的商户 API（下单 / 查单 / 证书），不接触任何个人钱包地址；
- 配置不完整时 ``is_configured()`` 返回 False，上层自动退回模拟支付；
- Webhook 必须用 Binance 证书公钥做 RSA-SHA256 验签，不能只信 JSON 内容。

官方签名规则：
    API 请求待签串 = timestamp + "\\n" + nonce + "\\n" + body + "\\n"
        API 请求用 HMAC-SHA512(API Secret)，结果 Base64
    Webhook 待签串与上面相同
        Binance 用私钥签名，商户用证书公钥（certPublic）验签
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import httpx

from ..config import (
    BINANCE_PAY_API_KEY,
    BINANCE_PAY_API_SECRET,
    BINANCE_PAY_BASE_URL,
    BINANCE_PAY_CERT_FILE,
    BINANCE_PAY_CERT_PUBLIC,
    BINANCE_PAY_CURRENCY,
    BINANCE_PAY_ENABLED,
    BINANCE_PAY_MERCHANT_ID,
    BINANCE_PAY_TIMEOUT,
    PAYMENT_CANCEL_URL,
    PAYMENT_RETURN_URL,
    PAYMENT_WEBHOOK_URL,
)

# 证书缓存：serial -> (抓取时间, PEM)。证书不常变，缓存一小时足够。
_CERT_CACHE: dict[str, tuple[float, str]] = {}
_CERT_TTL = 3600.0

# Webhook 时间戳容忍窗口。Binance 会重试，窗口太短会把重试全拒掉；
# 由于入账本身是幂等的，重放同一笔已支付通知不会重复加钱。
_WEBHOOK_TTL_MS = 3600_000


class BinancePayError(RuntimeError):
    """调用 Binance Pay 失败。消息可直接展示给调用方。"""


def is_configured() -> bool:
    """是否具备真实收款条件。Merchant ID 只做配置完整性校验，
    v3 下单的身份由 API Key/Secret 决定。"""
    return bool(
        BINANCE_PAY_ENABLED
        and BINANCE_PAY_MERCHANT_ID
        and BINANCE_PAY_API_KEY
        and BINANCE_PAY_API_SECRET
    )


# ------------------------------------------------------------------ 请求签名


def sign_request(secret: str, timestamp: str, nonce: str, body: str) -> str:
    payload = f"{timestamp}\n{nonce}\n{body}\n".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha512).digest()
    return base64.b64encode(digest).decode("ascii")


def _headers(body: str) -> dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)          # 32 位随机串
    return {
        "Content-Type": "application/json",
        "BinancePay-Timestamp": timestamp,
        "BinancePay-Nonce": nonce,
        "BinancePay-Certificate-SN": BINANCE_PAY_API_KEY,
        "BinancePay-Signature": sign_request(
            BINANCE_PAY_API_SECRET, timestamp, nonce, body
        ),
    }


def _post(path: str, payload: dict[str, Any]) -> Any:
    """统一 POST。body 必须先序列化成字符串，签名和发送必须用同一份字节。"""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    try:
        with httpx.Client(timeout=BINANCE_PAY_TIMEOUT) as client:
            resp = client.post(
                f"{BINANCE_PAY_BASE_URL}{path}",
                content=body.encode("utf-8"),
                headers=_headers(body),
            )
    except httpx.HTTPError as exc:
        raise BinancePayError(f"无法连接 Binance Pay：{exc}") from exc

    try:
        data = resp.json()
    except ValueError:
        raise BinancePayError(f"Binance Pay 返回非 JSON（HTTP {resp.status_code}）")

    code = str(data.get("code", ""))
    if resp.status_code >= 400 or code not in ("000000", "0", ""):
        message = (
            data.get("errorMessage")
            or data.get("message")
            or data.get("status")
            or resp.text[:200]
        )
        raise BinancePayError(f"Binance Pay 返回 {code or resp.status_code}：{message}")
    return data.get("data")


# ------------------------------------------------------------------ 业务接口


def create_order(
    *,
    merchant_trade_no: str,
    amount: float,
    description: str,
    goods_name: str,
    reference_goods_id: str,
) -> dict[str, Any]:
    """创建收银台订单，返回 checkoutUrl / qrContent / universalUrl 等。"""
    payload: dict[str, Any] = {
        "env": {"terminalType": "WEB"},
        "merchantTradeNo": merchant_trade_no,
        "orderAmount": round(float(amount), 2),
        "currency": BINANCE_PAY_CURRENCY,
        "description": description[:100],
        "goodsDetails": [
            {
                "goodsType": "01",
                "goodsCategory": "D000",
                "referenceGoodsId": reference_goods_id[:50],
                "goodsName": goods_name[:100],
            }
        ],
        "returnUrl": PAYMENT_RETURN_URL,
        "cancelUrl": PAYMENT_CANCEL_URL,
    }
    if PAYMENT_WEBHOOK_URL:
        payload["webhookUrl"] = PAYMENT_WEBHOOK_URL

    data = _post("/binancepay/openapi/v3/order", payload)
    return data if isinstance(data, dict) else {}


def query_order(merchant_trade_no: str) -> dict[str, Any]:
    """按商户订单号查单。orderStatus: INITIAL/PENDING/PAID/CANCELED/ERROR。"""
    data = _post(
        "/binancepay/openapi/v2/order/query",
        {"merchantTradeNo": merchant_trade_no},
    )
    return data if isinstance(data, dict) else {}


# ------------------------------------------------------------------ Webhook


def _normalise_pem(value: str) -> bytes:
    """Binance 的 certPublic 有时是不带 PEM 头的 Base64，这里统一补全。"""
    text = value.strip()
    if text.startswith("-----BEGIN"):
        return text.encode("utf-8")
    b64 = "".join(text.split())
    lines = "\n".join(b64[i : i + 64] for i in range(0, len(b64), 64))
    return f"-----BEGIN PUBLIC KEY-----\n{lines}\n-----END PUBLIC KEY-----\n".encode(
        "utf-8"
    )


def _fetch_certificates() -> dict[str, str]:
    data = _post("/binancepay/openapi/certificates", {})
    items = data if isinstance(data, list) else []
    result: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        serial = str(item.get("certSerial") or item.get("certSN") or "")
        public = item.get("certPublic") or item.get("certPublicKey") or ""
        if serial and public:
            result[serial] = str(public)
    return result


def get_certificate(serial: str) -> str:
    """按证书序列号取公钥；优先用本地配置，其次拉取并缓存。"""
    now = time.time()
    cached = _CERT_CACHE.get(serial)
    if cached and now - cached[0] < _CERT_TTL:
        return cached[1]

    # 优先用本地证书文件；其次用内联 PEM；最后才去调证书接口。
    if BINANCE_PAY_CERT_FILE:
        from pathlib import Path

        pem = Path(BINANCE_PAY_CERT_FILE).read_text(encoding="utf-8").strip()
        _CERT_CACHE[serial] = (now, pem)
        return pem
    if BINANCE_PAY_CERT_PUBLIC:
        _CERT_CACHE[serial] = (now, BINANCE_PAY_CERT_PUBLIC)
        return BINANCE_PAY_CERT_PUBLIC

    fetched = _fetch_certificates()
    for sn, pem in fetched.items():
        _CERT_CACHE[sn] = (now, pem)
    if serial in _CERT_CACHE:
        return _CERT_CACHE[serial][1]
    raise BinancePayError(f"找不到 Webhook 证书：{serial}")


def verify_webhook(headers: Any, raw_body: bytes) -> bool:
    """RSA-SHA256 验签。任何一步失败都返回 False，绝不放行未验证的通知。"""
    timestamp = headers.get("BinancePay-Timestamp")
    nonce = headers.get("BinancePay-Nonce")
    serial = headers.get("BinancePay-Certificate-SN")
    signature = headers.get("BinancePay-Signature")
    if not (timestamp and nonce and serial and signature):
        return False

    try:
        drift = abs(time.time() * 1000 - int(timestamp))
    except (TypeError, ValueError):
        return False
    if drift > _WEBHOOK_TTL_MS:
        return False

    try:
        # cryptography 只在真正验签时导入，未启用支付的环境不必安装它。
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        public_key = serialization.load_pem_public_key(
            _normalise_pem(get_certificate(serial))
        )
        payload = (
            timestamp.encode("utf-8")
            + b"\n"
            + nonce.encode("utf-8")
            + b"\n"
            + raw_body
            + b"\n"
        )
        public_key.verify(
            base64.b64decode(signature),
            payload,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


def parse_notification(raw_body: bytes) -> dict[str, Any] | None:
    """解析支付成功通知；非支付成功事件返回 None。

    data 在官方示例里既可能是对象，也可能是 JSON 字符串，两种都要兼容。
    """
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None

    biz_type = payload.get("bizType")
    if biz_type not in (None, "PAY"):
        return None
    biz_status = payload.get("bizStatus")
    if biz_status not in (None, "PAY_SUCCESS"):
        return None

    data = payload.get("data")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return None
    if not isinstance(data, dict):
        data = {}

    order_status = data.get("orderStatus") or payload.get("orderStatus")
    if order_status not in (None, "PAID"):
        return None

    merchant_trade_no = data.get("merchantTradeNo") or payload.get("merchantTradeNo")
    if not merchant_trade_no:
        return None

    return {
        "merchant_trade_no": str(merchant_trade_no),
        "order_status": order_status or "PAID",
        "transaction_id": data.get("transactionId"),
        "pay_amount": data.get("payAmount") or data.get("totalFee"),
        "currency": data.get("currency"),
    }
