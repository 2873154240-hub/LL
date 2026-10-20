# -*- coding: utf-8 -*-
"""LLM 适配层（OpenAI 兼容协议）。

设计要点：
- 不配 LLM_API_KEY 时直接返回 None，调用方回退到内置规则引擎，
  所以整套系统「零配置可跑」；
- 只让模型补充叙述性字段（结论标题、理由、风险），不让它重算价格，
  避免模型编出与行情对不上的数字；
- 输出严格校验，任何一项不合法就整段丢弃，宁可用规则引擎的版本。
"""
from __future__ import annotations

import json
import logging

import httpx

from ..config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一名严谨的卖方研究员，为中文用户撰写标的交易研究结论。
只输出 JSON，不要 Markdown 代码块，不要解释。

JSON 结构：
{
  "headline": "一句话结论，25 字以内，先给判断",
  "reasons": [{"text": "理由，40 字以内，必须引用给定数字", "weight": 0.3}],
  "risks": [{"level": "high|warn|info", "text": "风险提示，30 字以内"}],
  "invalidation": "结论失效条件，30 字以内",
  "no_trade_condition": "什么情况下不应该开仓，30 字以内"
}

要求：
1. reasons 给 3-5 条，weight 之和约等于 1；
2. 不得编造输入里没有的数字；
3. 语气客观，不使用「必涨」「稳赚」等措辞；
4. 这是研究参考，不是投资建议。
"""


async def refine(card: dict, model: str | None = None) -> dict | None:
    """把规则引擎算出的结论交给 LLM 润色叙述。失败返回 None。"""
    if not LLM_API_KEY:
        return None

    context = {
        "标的": card["symbol"],
        "名称": card["name"],
        "市场": card["market_label"],
        "周期": card["interval"],
        "现价": card["price"],
        "24h涨跌幅": card["change_24h"],
        "方向判断": card["verdict_label"],
        "技术快照": card["evidence"],
        "关键价位": card["key_levels"],
        "交易计划": card["plan"],
        "市场状态": card["market_state"]["label"],
    }

    body = {
        "model": model or LLM_MODEL,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(
                f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_API_KEY}"},
                json=body,
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
    except Exception as exc:      # 网络、限流、格式错误一律降级
        log.warning("LLM 调用失败，回退规则引擎: %s", exc)
        return None

    if not isinstance(data, dict):
        return None

    out = {}
    if isinstance(data.get("headline"), str) and data["headline"].strip():
        out["headline"] = data["headline"].strip()[:60]

    reasons = data.get("reasons")
    if isinstance(reasons, list) and reasons:
        cleaned = []
        for item in reasons[:5]:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            try:
                weight = float(item.get("weight", 0.2))
            except (TypeError, ValueError):
                weight = 0.2
            cleaned.append({"text": text[:80], "weight": round(max(0.0, min(1.0, weight)), 2)})
        if cleaned:
            out["reasons"] = cleaned

    risks = data.get("risks")
    if isinstance(risks, list) and risks:
        cleaned = []
        for item in risks[:5]:
            if not isinstance(item, dict):
                continue
            level = item.get("level", "info")
            if level not in ("high", "warn", "info"):
                level = "info"
            text = str(item.get("text", "")).strip()
            if text:
                cleaned.append({"level": level, "text": text[:60]})
        if cleaned:
            out["risks"] = cleaned

    for key in ("invalidation", "no_trade_condition"):
        if isinstance(data.get(key), str) and data[key].strip():
            out[key] = data[key].strip()[:80]

    return out or None
