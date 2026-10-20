# -*- coding: utf-8 -*-
"""技术指标计算（纯 Python，不引 numpy/pandas）。

为什么手写：这套指标每个只有十几行，装 numpy 反而让部署变重；
而且教学/审计时能一眼看懂每一步在算什么。

约定：所有函数输入是从旧到新的序列，返回同长度的列表，
前 n-1 个位置为 None（数据不足），最后一格才是「当前值」。
"""
from __future__ import annotations

import math


def sma(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= n:
            total -= values[i - n]
        out.append(total / n if i >= n - 1 else None)
    return out


def ema(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    k = 2 / (n + 1)
    prev = None
    for i, v in enumerate(values):
        if i == 0:
            prev = v
        else:
            prev = v * k + prev * (1 - k)
        out.append(prev if i >= n - 1 else None)
    return out


def rsi(values: list[float], n: int = 14) -> list[float | None]:
    if len(values) < n + 1:
        return [None] * len(values)
    out: list[float | None] = [None] * len(values)
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = values[i] - values[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_gain, avg_loss = gains / n, losses / n
    out[n] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(n + 1, len(values)):
        d = values[i] - values[i - 1]
        avg_gain = (avg_gain * (n - 1) + max(d, 0.0)) / n
        avg_loss = (avg_loss * (n - 1) + max(-d, 0.0)) / n
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd(values: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = ema(values, fast)
    ema_slow = ema(values, slow)
    dif = [None if (a is None or b is None) else a - b for a, b in zip(ema_fast, ema_slow)]
    valid = [x if x is not None else 0.0 for x in dif]
    dea = ema(valid, signal)
    dea = [d if dif[i] is not None else None for i, d in enumerate(dea)]
    hist = [None if (a is None or b is None) else a - b for a, b in zip(dif, dea)]
    return dif, dea, hist


def true_range(candles: list[list]) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        _, _, high, low, close, _ = c
        if i == 0:
            out.append(high - low)
        else:
            prev_close = candles[i - 1][4]
            out.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    return out


def atr(candles: list[list], n: int = 14) -> list[float | None]:
    tr = true_range(candles)
    out: list[float | None] = [None] * len(tr)
    if len(tr) < n:
        return out
    prev = sum(tr[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(tr)):
        prev = (prev * (n - 1) + tr[i]) / n   # Wilder 平滑
        out[i] = prev
    return out


def adx(candles: list[list], n: int = 14) -> list[float | None]:
    """平均趋向指数：衡量趋势强度（不辨方向）。>25 视为有趋势。"""
    length = len(candles)
    out: list[float | None] = [None] * length
    if length < n * 2:
        return out

    trs, plus_dm, minus_dm = [], [], []
    for i in range(1, length):
        prev_h, prev_l = candles[i - 1][2], candles[i - 1][3]
        high, low = candles[i][2], candles[i][3]
        up = high - prev_h
        down = prev_l - low
        plus_dm.append(up if up > down and up > 0 else 0.0)
        minus_dm.append(down if down > up and down > 0 else 0.0)
        trs.append(max(high - low, abs(high - candles[i - 1][4]), abs(low - candles[i - 1][4])))

    # Wilder 平滑
    atr_s = sum(trs[:n])
    plus_s = sum(plus_dm[:n])
    minus_s = sum(minus_dm[:n])
    dxs: list[float] = []
    for i in range(n, len(trs)):
        atr_s = atr_s - atr_s / n + trs[i]
        plus_s = plus_s - plus_s / n + plus_dm[i]
        minus_s = minus_s - minus_s / n + minus_dm[i]
        pdi = 100 * plus_s / atr_s if atr_s else 0
        mdi = 100 * minus_s / atr_s if atr_s else 0
        denom = pdi + mdi
        dxs.append(100 * abs(pdi - mdi) / denom if denom else 0.0)

    if len(dxs) < n:
        return out
    prev = sum(dxs[:n]) / n
    out[n * 2 - 1] = prev
    for i in range(n, len(dxs)):
        prev = (prev * (n - 1) + dxs[i]) / n
        idx = n * 2 - 1 + (i - n + 1)
        if idx < length:
            out[idx] = prev
    return out


def swing_levels(candles: list[list], window: int = 3, max_levels: int = 3):
    """局部极值 -> 支撑/阻力位。越靠近现价、被触碰次数越多，强度越高。"""
    highs, lows = [], []
    n = len(candles)
    for i in range(window, n - window):
        h = candles[i][2]
        l = candles[i][3]
        if all(h >= candles[j][2] for j in range(i - window, i + window + 1)):
            highs.append(h)
        if all(l <= candles[j][3] for j in range(i - window, i + window + 1)):
            lows.append(l)

    price = candles[-1][4]

    def rank(levels, below):
        filtered = [x for x in levels if (x < price if below else x > price)]
        # 按与现价的距离排序，近的优先；再按出现次数加权
        uniq = []
        for x in sorted(filtered, key=lambda y: abs(y - price)):
            if all(abs(x - u) / price > 0.004 for u in uniq):
                uniq.append(x)
            if len(uniq) >= max_levels:
                break
        out = []
        for x in uniq:
            touches = sum(1 for lv in levels if abs(lv - x) / price <= 0.004)
            dist = abs(x - price) / price
            strength = "强" if touches >= 3 or dist < 0.01 else ("中" if touches >= 2 else "弱")
            out.append({"price": round(x, 4), "strength": strength, "touches": touches})
        return out

    return rank(lows, True), rank(highs, False)


def detect_divergence(closes: list[float], osc: list[float | None], lookback: int = 24) -> dict:
    """简化版背离检测：比较最近两段价格高低点与振荡指标方向是否相反。"""
    pairs = [(p, o) for p, o in zip(closes, osc) if o is not None]
    if len(pairs) < lookback:
        return {"type": "none", "label": "无背离"}
    recent = pairs[-lookback:]
    half = len(recent) // 2
    first, second = recent[:half], recent[half:]

    price_high = (max(x[0] for x in first), max(x[0] for x in second))
    osc_high = (max(x[1] for x in first), max(x[1] for x in second))
    if price_high[1] > price_high[0] and osc_high[1] < osc_high[0]:
        return {"type": "bearish", "label": "顶背离", "detail": "价创新高但指标回落，警惕反转"}

    price_low = (min(x[0] for x in first), min(x[0] for x in second))
    osc_low = (min(x[1] for x in first), min(x[1] for x in second))
    if price_low[1] < price_low[0] and osc_low[1] > osc_low[0]:
        return {"type": "bullish", "label": "底背离", "detail": "价创新低但指标抬升，警惕反弹"}

    return {"type": "none", "label": "无背离", "detail": "价格与指标同步"}


def percentile_rank(values: list[float], window: int = 720) -> float:
    """当前值在过去窗口中的分位（0-100）"""
    window_values = values[-window:]
    if len(window_values) < 10:
        return 50.0
    current = window_values[-1]
    below = sum(1 for v in window_values if v < current)
    return round(below / len(window_values) * 100, 1)


def analyze(candles: list[list]) -> dict:
    """一次算全，返回研究引擎需要的所有指标快照。"""
    closes = [c[4] for c in candles]
    volumes = [c[5] for c in candles]
    highs = [c[2] for c in candles]
    lows = [c[3] for c in candles]

    ma5 = sma(closes, 5)[-1]
    ma20 = sma(closes, 20)[-1]
    ma60 = sma(closes, 60)[-1]
    rsi_series = rsi(closes, 14)
    dif, dea, hist = macd(closes)
    adx_series = adx(candles, 14)
    atr_series = atr(candles, 14)

    price = closes[-1]
    atr_now = atr_series[-1] or (price * 0.02)
    vol_avg = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
    vol_ratio = volumes[-1] / vol_avg if vol_avg else 1.0

    support, resistance = swing_levels(candles)

    trend = "震荡"
    if ma5 and ma20:
        if price > ma5 > ma20:
            trend = "多头排列"
        elif price < ma5 < ma20:
            trend = "空头排列"
        elif price > ma20:
            trend = "偏多"
        elif price < ma20:
            trend = "偏空"

    divergence = detect_divergence(closes, rsi_series)
    macd_div = detect_divergence(closes, dif)

    return {
        "price": round(price, 4),
        "ma5": round(ma5, 4) if ma5 else None,
        "ma20": round(ma20, 4) if ma20 else None,
        "ma60": round(ma60, 4) if ma60 else None,
        "rsi": round(rsi_series[-1], 1) if rsi_series[-1] is not None else None,
        "macd_dif": round(dif[-1], 4) if dif[-1] is not None else None,
        "macd_dea": round(dea[-1], 4) if dea[-1] is not None else None,
        "macd_hist": round(hist[-1], 4) if hist[-1] is not None else None,
        "adx": round(adx_series[-1], 1) if adx_series[-1] is not None else None,
        "atr": round(atr_now, 4),
        "atr_pct": round(atr_now / price * 100, 2) if price else 0.0,
        "volume_ratio": round(vol_ratio, 2),
        "percentile_30d": percentile_rank(closes, 720),
        "trend": trend,
        "support": support,
        "resistance": resistance,
        "divergence": divergence,
        "macd_divergence": macd_div,
        "high_20": round(max(highs[-20:]), 4),
        "low_20": round(min(lows[-20:]), 4),
        "range_pct": round((max(highs[-20:]) - min(lows[-20:])) / price * 100, 2) if price else 0.0,
    }


def probability_from_score(score: float) -> float:
    """把 -100..100 的方向分映射成 0..1 的上行概率，用 logistic 收敛在 0.15~0.85。"""
    p = 1 / (1 + math.exp(-score / 35))
    return round(0.15 + p * 0.70, 3)
