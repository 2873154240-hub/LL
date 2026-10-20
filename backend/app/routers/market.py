# -*- coding: utf-8 -*-
"""行情接口。

所有接口只返回真实行情。数据源全部失败时返回 503，
前端会显示明确的错误，而不是伪造一条曲线。
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..services import market_data
from ..services.research import list_models

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/symbols")
async def symbols(market: str = Query("all", pattern="^(all|crypto)$")):
    items = await market_data.list_symbols(market)
    return {"items": items, "total": len(items)}


@router.get("/models")
def models():
    return {"items": list_models()}


def _public_ticker(t: dict) -> dict:
    return {
        "symbol": t["symbol"],
        "market": t["market"],
        "price": round(float(t["price"]), 6),
        "change_24h": round(float(t["change_24h"]), 2),
        "high_24h": round(float(t["high_24h"]), 6),
        "low_24h": round(float(t["low_24h"]), 6),
        "volume_24h": round(float(t["volume_24h"]), 2),
        "source": t["source"],
        "source_label": t["source_label"],
        "quoted_at": t["quoted_at"],
        "quote_time": t.get("quote_time"),
    }


@router.get("/ticker")
async def ticker(
    symbols: str = Query(..., description="逗号分隔，如 BTCUSDT,ETHUSDT"),
    market: str = Query("crypto", pattern="^(crypto)$"),
):
    """批量实时报价，供前端轮询。5 秒服务端缓存，不会打爆上游。"""
    wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()][:300]
    if not wanted:
        raise HTTPException(400, "symbols 不能为空")

    try:
        data = await market_data.fetch_tickers(wanted, market)
    except Exception as exc:
        raise HTTPException(503, f"行情获取失败: {exc}")

    return {
        "server_time": market_data._now_iso(),
        "items": [_public_ticker(data[s]) for s in wanted if s in data],
        "missing": [s for s in wanted if s not in data],
        "state": market_data.market_state(market),
    }


@router.get("/overview")
async def overview(
    symbol: str,
    market: str = Query("crypto", pattern="^(crypto)$"),
    interval: str = Query("1h", pattern="^(15m|1h|4h|1d)$"),
):
    try:
        data = await market_data.fetch_market(symbol, market, interval, limit=200)
    except Exception as exc:
        raise HTTPException(503, f"行情获取失败: {exc}")

    return {
        "symbol": data["symbol"],
        "name": data["name"],
        "sector": data["sector"],
        "market": data["market"],
        "market_label": data["market_label"],
        "interval": data["interval"],
        "price": round(float(data["last"]), 6),
        "change_24h": round(float(data["change_24h"]), 2),
        "high_24h": round(float(data["high_24h"]), 6),
        "low_24h": round(float(data["low_24h"]), 6),
        "volume_24h": round(float(data["volume_24h"]), 2),
        "source": data["source"],
        "source_label": data["source_label"],
        "quoted_at": data["quoted_at"],
        "quote_time": data.get("quote_time"),
        "state": data["state"],
        "candles": [[c[0], c[4]] for c in data["candles"][-120:]],
    }


@router.get("/quotes")
async def quotes(
    market: str = Query("crypto", pattern="^(crypto)$"),
    limit: int = Query(40, ge=1, le=120),
):
    """标的列表的实时涨跌快照。批量抓取，避免逐个请求拖慢首屏。"""
    catalog = (await market_data.list_symbols(market))[:limit]
    symbols = [item["symbol"] for item in catalog]

    try:
        data = await market_data.fetch_tickers(symbols, market)
    except Exception:
        data = {}

    items = []
    for item in catalog:
        t = data.get(item["symbol"])
        items.append({
            **item,
            "price": round(float(t["price"]), 6) if t else None,
            "change_24h": round(float(t["change_24h"]), 2) if t else None,
            "source": t["source"] if t else "unavailable",
            "source_label": t["source_label"] if t else "",
            "quoted_at": t["quoted_at"] if t else None,
        })
    return {"items": items, "state": market_data.market_state(market)}
