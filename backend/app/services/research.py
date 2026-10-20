# -*- coding: utf-8 -*-
"""AI 研究引擎：把行情快照变成一张可执行的决策卡片。

核心原则（也是和「让大模型自由发挥」最大的区别）：
1. **数字全部由代码算**，模型只负责把结论讲清楚。价格、止损、仓位不是生成出来的，
   是按规则推出来的，所以不会出现「模型说 120 美元但现价 180」这种事故。
2. **每个结论都带失效条件**。没有失效条件的观点不可执行。
3. **不给绝对收益承诺**。输出的是决策边界，不是买卖指令。
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from . import indicators as ind
from . import llm
from ..config import LLM_API_KEY, LLM_MODEL

VERDICT_LABELS = {"long": "做多", "short": "做空", "wait": "观望", "avoid": "回避"}
RISK_ORDER = {"high": 0, "warn": 1, "info": 2}


def list_models() -> list[dict]:
    models = [{
        "id": "auto",
        "name": "内置研究引擎",
        "desc": "本地规则引擎，无需 API Key，结果可复现",
        "available": True,
    }]
    if LLM_API_KEY:
        models.append({
            "id": LLM_MODEL,
            "name": LLM_MODEL,
            "desc": "规则引擎定价 + 大模型润色叙述",
            "available": True,
        })
    return models


# ------------------------------------------------------------------ 打分


def _score(snap: dict, change_24h: float):
    """返回 (方向分 -100..100, 理由列表, 各维度得分)"""
    score = 0.0
    reasons: list[dict] = []

    def add(points: float, text: str, weight: float):
        nonlocal score
        score += points
        reasons.append({"text": text, "weight": weight, "points": round(points, 1)})

    price, ma5, ma20 = snap["price"], snap["ma5"], snap["ma20"]

    # --- 趋势 -------------------------------------------------------------
    trend = snap["trend"]
    if trend == "多头排列":
        add(24, f"价格 {price} 站上 MA5({ma5}) 与 MA20({ma20})，均线多头排列", 0.26)
    elif trend == "空头排列":
        add(-24, f"价格 {price} 跌破 MA5({ma5}) 与 MA20({ma20})，均线空头排列", 0.26)
    elif trend == "偏多":
        add(10, f"价格位于 MA20({ma20}) 上方，中期结构偏多", 0.16)
    elif trend == "偏空":
        add(-10, f"价格位于 MA20({ma20}) 下方，中期结构偏空", 0.16)

    # --- 趋势强度（ADX 只放大已有方向，不自己产生方向）-------------------
    adx_v = snap["adx"]
    if adx_v is not None and adx_v >= 25 and trend in ("多头排列", "空头排列"):
        bonus = 8 if trend == "多头排列" else -8
        add(bonus, f"ADX {adx_v} 说明趋势明确，方向性信号可信度提高", 0.12)

    # --- RSI ---------------------------------------------------------------
    rsi_v = snap["rsi"]
    if rsi_v is not None:
        if rsi_v <= 32:
            add(10, f"RSI {rsi_v} 进入超卖区，存在技术性反弹需求", 0.13)
        elif rsi_v >= 68:
            add(-10, f"RSI {rsi_v} 进入超买区，追高风险上升", 0.13)
        else:
            add((rsi_v - 50) * 0.25, f"RSI {rsi_v}，多空动能温和", 0.08)

    # --- MACD --------------------------------------------------------------
    hist = snap["macd_hist"]
    if hist is not None:
        if hist > 0:
            add(10, f"MACD 柱为正（{hist}），短期动能向上", 0.12)
        else:
            add(-10, f"MACD 柱为负（{hist}），短期动能向下", 0.12)

    # --- 量能 --------------------------------------------------------------
    vr = snap["volume_ratio"]
    if change_24h > 0.5 and vr >= 1.2:
        add(7, f"上涨伴随放量（量比 {vr}），资金参与度提升", 0.10)
    elif change_24h < -0.5 and vr >= 1.2:
        add(-7, f"下跌伴随放量（量比 {vr}），抛压明显", 0.10)

    # --- 背离 --------------------------------------------------------------
    div = snap["divergence"]
    if div["type"] == "bearish":
        add(-10, div["detail"], 0.11)
    elif div["type"] == "bullish":
        add(10, div["detail"], 0.11)

    # --- 24h 动量 ----------------------------------------------------------
    momentum = max(-4.0, min(4.0, change_24h)) * 1.4
    add(momentum, f"24 小时涨跌幅 {change_24h}%", 0.08)

    score = max(-100.0, min(100.0, score))

    # --- 分维度打分（0-100，50 为中性）------------------------------------
    trend_dim = 50
    trend_dim += 22 if trend == "多头排列" else -22 if trend == "空头排列" else 0
    trend_dim += 8 if (adx_v or 0) >= 25 else 0
    tech = max(0, min(100, trend_dim))

    fund = 50 + (vr - 1) * 25 + max(-4, min(4, change_24h)) * 4
    fund = max(0, min(100, fund))

    senti = 50 + ((rsi_v - 50) if rsi_v is not None else 0) * 0.9
    senti = max(0, min(100, senti))

    # 结构面：离支撑近偏多，离阻力近偏空
    sup = snap["support"][0]["price"] if snap["support"] else price * 0.97
    res = snap["resistance"][0]["price"] if snap["resistance"] else price * 1.03
    span = max(res - sup, 1e-9)
    struct = 50 + ((res - price) - (price - sup)) / span * 30
    struct = max(0, min(100, struct))

    form = 50 + (15 if (hist or 0) > 0 else -15)
    form += 12 if div["type"] == "bullish" else -12 if div["type"] == "bearish" else 0
    form = max(0, min(100, form))

    dims = [
        {"name": "技术面", "score": round(tech)},
        {"name": "资金面", "score": round(fund)},
        {"name": "情绪面", "score": round(senti)},
        {"name": "结构面", "score": round(struct)},
        {"name": "形态面", "score": round(form)},
    ]

    # 理由按权重归一化后取前 5 条
    total_w = sum(abs(r["weight"]) for r in reasons) or 1
    for r in reasons:
        r["weight"] = round(abs(r["weight"]) / total_w, 2)
    reasons.sort(key=lambda x: abs(x["points"]), reverse=True)
    return round(score, 1), reasons[:5], dims


# ------------------------------------------------------------------ 计划


def _plan(verdict: str, snap: dict):
    price = snap["price"]
    atr = snap["atr"]
    sup = snap["support"][0]["price"] if snap["support"] else price - atr * 1.5
    res = snap["resistance"][0]["price"] if snap["resistance"] else price + atr * 1.5

    atr_pct = snap["atr_pct"]
    if atr_pct < 1.0:
        leverage, position = 5, 30
    elif atr_pct < 2.0:
        leverage, position = 4, 25
    elif atr_pct < 3.5:
        leverage, position = 3, 20
    elif atr_pct < 5.0:
        leverage, position = 2, 15
    else:
        leverage, position = 1, 10

    if verdict == "long":
        zone_low = round(max(sup, price - atr * 0.8), 4)
        zone_high = round(max(zone_low, price - atr * 0.1), 4)
        stop = round(min(sup - atr * 0.2, zone_low - atr * 1.2), 4)
        tp1 = round(max(price + atr * 2.0, res), 4)
        tp2 = round(price + atr * 3.5, 4)
        trigger = f"价格回踩 {zone_low}–{zone_high} 区间且不破 {stop}，或放量站上 {round(price + atr * 0.3, 4)}"
        entry_cond = "回踩不破 + 出现止跌信号（长下影/阳包阴）后分批介入"
        invalidation = f"收盘价跌破 {stop}，多头结构失效"
        no_trade = f"价格直接跳空高于 {round(price + atr * 0.8, 4)} 时放弃追高"
        reverse_dir, reverse_stop_base = "short", zone_low
    elif verdict == "short":
        zone_high = round(min(res, price + atr * 0.8), 4)
        zone_low = round(min(zone_high, price + atr * 0.1), 4)
        stop = round(max(res + atr * 0.2, zone_high + atr * 1.2), 4)
        tp1 = round(min(price - atr * 2.0, sup), 4)
        tp2 = round(price - atr * 3.5, 4)
        trigger = f"价格反弹至 {zone_low}–{zone_high} 区间且不破 {stop}，或跌破 {round(price - atr * 0.3, 4)}"
        entry_cond = "反弹遇阻 + 出现滞涨信号（长上影/阴包阳）后分批介入"
        invalidation = f"收盘价站上 {stop}，空头结构失效"
        no_trade = f"价格直接低开低于 {round(price - atr * 0.8, 4)} 时放弃追空"
        reverse_dir, reverse_stop_base = "long", zone_high
    else:
        # 观望 / 回避：给出触发条件而不是入场价
        zone_low = round(sup, 4)
        zone_high = round(res, 4)
        stop = round(sup - atr * 1.2, 4)
        tp1 = round(price + atr * 2.0, 4)
        tp2 = round(price + atr * 3.5, 4)
        trigger = f"向上突破 {res} 或向下跌破 {sup}，且收盘确认后重新评估"
        entry_cond = "任一方向突破成立前不建仓"
        invalidation = f"价格在 {sup}–{res} 区间内反复震荡，本次结论自动失效"
        no_trade = "方向未明、波动不足时保持空仓"
        reverse_dir, reverse_stop_base = "long", sup

    entry_mid = round((zone_low + zone_high) / 2, 4)
    risk = abs(entry_mid - stop) or atr
    reward = abs(tp1 - entry_mid)
    rr = round(reward / risk, 2) if risk else 0

    # 止损百分比统一取负值（表达「止损时的亏损」），做多做空都是负数，前端不用再判方向
    stop_pct = -round(abs(stop - entry_mid) / entry_mid * 100, 2) if entry_mid else 0.0
    # 单笔风险 = 仓位占比 × 止损幅度，例如 20% 仓位 × 5% 止损 = 账户的 1%
    risk_per_trade = round(position / 100 * abs(stop_pct), 2)

    plan = {
        "direction": verdict if verdict in ("long", "short") else "none",
        "trigger": trigger,
        "entry": {
            "zone": [zone_low, zone_high],
            "condition": entry_cond,
        },
        "stop_loss": {
            "price": stop,
            "percentage": stop_pct,
            "basis": "前低/前高外侧再留 0.2–1.2 倍 ATR，避开插针扫损",
        },
        "take_profit": {"conservative": tp1, "aggressive": tp2},
        "leverage": leverage,
        "position_percentage": position,
        "risk_reward": rr,
        "invalidation": invalidation,
        "no_trade_condition": no_trade,
        "risk_per_trade_pct": risk_per_trade,
    }

    # 反向预案：与主结论相反的方向，触发价取主方向的止损侧
    if reverse_dir == "short":
        r_zone = [round(reverse_stop_base, 4), round(reverse_stop_base + atr * 0.3, 4)]
        r_stop = round(reverse_stop_base + atr * 1.5, 4)
        r_tp = round(reverse_stop_base - atr * 2.5, 4)
        r_trigger = f"若跌破 {reverse_stop_base} 并收在其下方，反手看空"
    else:
        r_zone = [round(reverse_stop_base - atr * 0.3, 4), round(reverse_stop_base, 4)]
        r_stop = round(reverse_stop_base - atr * 1.5, 4)
        r_tp = round(reverse_stop_base + atr * 2.5, 4)
        r_trigger = f"若站上 {reverse_stop_base} 并收在其上方，反手看多"

    reverse = {
        "direction": reverse_dir,
        "direction_label": VERDICT_LABELS.get(reverse_dir, reverse_dir),
        "trigger": r_trigger,
        "entry": {"zone": r_zone},
        "stop_loss": {"price": r_stop},
        "take_profit": {"conservative": r_tp},
    }
    return plan, reverse


# ------------------------------------------------------------------ 周期


def _cycles(snap: dict, score: float):
    price = snap["price"]
    ma5, ma20, ma60 = snap["ma5"], snap["ma20"], snap["ma60"]

    def bias_from(value: float, threshold: float) -> tuple[str, float]:
        if value > threshold * 1.004:
            return "偏多", min(0.85, 0.5 + abs(value - threshold) / threshold * 3)
        if value < threshold * 0.996:
            return "偏空", min(0.85, 0.5 + abs(value - threshold) / threshold * 3)
        return "中性", 0.5

    daily_bias, daily_conf = bias_from(price, ma5 or price)
    swing_bias, swing_conf = bias_from(price, ma20 or price)
    mid_bias, mid_conf = bias_from(price, ma60 or price)

    if abs(score) < 12:
        daily_bias, daily_conf = "分歧", 0.5

    return [
        {"period": "日内", "bias": daily_bias, "confidence": round(daily_conf, 2)},
        {"period": "波段", "bias": swing_bias, "confidence": round(swing_conf, 2)},
        {"period": "中期", "bias": mid_bias, "confidence": round(mid_conf, 2)},
    ]


# ------------------------------------------------------------------ 主流程


def build_card(data: dict) -> dict:
    """行情 dict -> 决策卡片"""
    snap = ind.analyze(data["candles"])
    price = snap["price"]
    change = float(data["change_24h"])
    score, reasons, dims = _score(snap, change)

    atr_pct = snap["atr_pct"]
    adx_v = snap["adx"] or 0
    state = data["state"]

    # 结论判定：先看风险条件，再看向方向分
    if atr_pct > 7.0:
        verdict = "avoid"
        headline = "波动率过高，风险收益比不划算，先回避"
    elif adx_v < 12 and abs(score) < 18:
        verdict = "avoid"
        headline = "趋势强度不足且方向不明，保持空仓也是结论"
    elif score >= 25:
        verdict = "long"
        headline = "结构偏多，回踩不破即为入场窗口"
    elif score <= -25:
        verdict = "short"
        headline = "结构偏空，反弹遇阻可顺势参与"
    elif score >= 10:
        verdict = "wait"
        headline = "略偏多但优势不足，等待价格证明方向"
    elif score <= -10:
        verdict = "wait"
        headline = "略偏空但优势不足，等待价格证明方向"
    else:
        verdict = "wait"
        headline = "多空均衡，等待区间突破后再判断"

    plan, reverse = _plan(verdict, snap)

    # 信心：方向分越强、维度越一致，胜率估计越高
    dim_avg = sum(d["score"] for d in dims) / len(dims)
    agreement = sum(1 for d in dims if (d["score"] - 50) * (score / 100) > 0) / len(dims)
    win_rate = 0.5 + score / 320 + (dim_avg - 50) / 500
    win_rate = max(0.35, min(0.78, win_rate))
    level = "high" if win_rate >= 0.62 else "mid" if win_rate >= 0.52 else "low"

    # 事件合约：到期价相对起始价
    prob_up = ind.probability_from_score(score)
    expected = round(price * (1 + score / 100 * atr_pct / 100), 4)
    band = snap["atr"] * 1.2
    if prob_up >= 0.58:
        rec = "buy_call"
    elif prob_up <= 0.42:
        rec = "buy_put"
    else:
        rec = "none"

    event = {
        "anchor_price": price,
        "expiry_price": expected,
        "interval": data["interval"],
        "range": {"low": round(price - band, 4), "high": round(price + band, 4)},
        "probability": {"up": prob_up, "down": round(1 - prob_up, 3)},
        "recommendation": rec,
        "recommendation_label": {"buy_call": "买看涨", "buy_put": "买看跌", "none": "不做"}[rec],
        "max_buy_price": round(max(0.0, prob_up * 100 - 3), 1) if rec == "buy_call"
                         else round(max(0.0, (1 - prob_up) * 100 - 3), 1) if rec == "buy_put" else 0.0,
        "abandon_condition": f"若到期前价格突破 {round(price + band, 4)} 或跌破 {round(price - band, 4)}，放弃该笔",
        "settlement_rule": "到期价相对起始价判定：高于起始价看涨合约结算，低于则看跌合约结算",
    }

    # 风险
    risks = []
    if atr_pct > 5:
        risks.append({"level": "high", "text": f"ATR 约 {atr_pct}%，波动剧烈，仓位需显著降低"})
    elif atr_pct > 3:
        risks.append({"level": "warn", "text": f"ATR 约 {atr_pct}%，波动偏高，控制单笔风险"})
    if snap["divergence"]["type"] != "none":
        risks.append({"level": "warn", "text": f"检测到{snap['divergence']['label']}，留意反转"})
    if snap["volume_ratio"] < 0.6:
        risks.append({"level": "warn", "text": "成交清淡，流动性不足，警惕插针"})
    if snap["rsi"] is not None and snap["rsi"] > 75:
        risks.append({"level": "warn", "text": f"RSI {snap['rsi']} 处于极值，追多风险大"})
    if not risks:
        risks.append({"level": "info", "text": "未识别到额外风险标记"})
    risks.sort(key=lambda r: RISK_ORDER.get(r["level"], 9))

    card = {
        "symbol": data["symbol"],
        "name": data["name"],
        "sector": data["sector"],
        "market": data["market"],
        "market_label": data["market_label"],
        "interval": data["interval"],
        "model": "auto",
        "source": data["source"],
        "source_label": data.get("source_label", data["source"]),
        "quoted_at": data.get("quoted_at"),
        "quote_time": data.get("quote_time"),
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
        "price": price,
        "change_24h": change,
        "high_24h": round(float(data["high_24h"]), 4),
        "low_24h": round(float(data["low_24h"]), 4),
        "volume_24h": round(float(data["volume_24h"]), 2),
        "market_state": state,
        "verdict": verdict,
        "verdict_label": VERDICT_LABELS[verdict],
        "headline": headline,
        "score": score,
        "confidence": {
            "win_rate": round(win_rate, 3),
            "level": level,
            "breakdown": dims,
            "agreement": round(agreement, 2),
        },
        "reasons": reasons,
        "key_levels": {
            "support": snap["support"],
            "resistance": snap["resistance"],
        },
        "plan": plan,
        "reverse_plan": reverse,
        "cycles": _cycles(snap, score),
        "risks": risks,
        "event_contract": event,
        "evidence": {
            "price": price,
            "ma5": snap["ma5"],
            "ma20": snap["ma20"],
            "ma60": snap["ma60"],
            "rsi": snap["rsi"],
            "macd_dif": snap["macd_dif"],
            "macd_dea": snap["macd_dea"],
            "macd_hist": snap["macd_hist"],
            "adx": snap["adx"],
            "atr": snap["atr"],
            "atr_pct": atr_pct,
            "volume_ratio": snap["volume_ratio"],
            "percentile_30d": snap["percentile_30d"],
            "trend": snap["trend"],
            "high_20": snap["high_20"],
            "low_20": snap["low_20"],
            "range_pct": snap["range_pct"],
        },
        "candles": [[c[0], c[4]] for c in data["candles"][-120:]],   # 前端画迷你走势用
        "disclaimer": "研究建议仅提供决策边界，不会自动向交易所提交订单，也不构成投资建议。",
    }
    return card


async def run_research(data: dict, model: str = "auto") -> dict:
    """完整研究流程：规则引擎定价 -> 可选 LLM 润色 -> 合并"""
    card = build_card(data)
    card["model"] = model

    if LLM_API_KEY and model != "auto":
        refined = await llm.refine(card, model)
        if refined:
            card.update(refined)
            card["model"] = model
            card["narrative_by"] = "llm"
    if "narrative_by" not in card:
        card["narrative_by"] = "rule-engine"
    return card
