# -*- coding: utf-8 -*-
"""站点开关的持久状态。

为什么不用数据库：这是「一个人的开关」，需求是改了立刻生效、坏了也能手改。
一个 JSON 文件比一张表更直观，服务器挂了也能用记事本打开确认状态。

文件是唯一真相：API 和 CLI 都读写同一个 `data/site_state.json`，
所以即使后端进程正在运行，命令行 `python site_switch.py off` 也会立刻生效。
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import DATA_DIR

STATE_FILE = DATA_DIR / "site_state.json"

_DEFAULT = {
    "enabled": True,
    "message": "站点正在维护，请稍后再试。",
    "updated_at": None,
    "updated_by": "system",
}

_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_state() -> dict:
    """读取开关状态。文件不存在/损坏时按「开启」处理，避免把自己锁在门外。"""
    with _LOCK:
        state = dict(_DEFAULT)
        if not STATE_FILE.exists():
            return state
        try:
            raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return state
        if isinstance(raw, dict):
            state.update({k: raw[k] for k in _DEFAULT if k in raw})
        return state


def save_state(enabled: bool, message: str | None = None, updated_by: str = "owner") -> dict:
    """原子写入，避免进程被杀时留下半个文件。"""
    with _LOCK:
        state = {
            "enabled": bool(enabled),
            "message": (message or _DEFAULT["message"]).strip()[:200],
            "updated_at": _now_iso(),
            "updated_by": updated_by,
        }
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_FILE)
        return state


def is_enabled() -> bool:
    return bool(load_state()["enabled"])
