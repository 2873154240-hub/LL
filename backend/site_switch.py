# -*- coding: utf-8 -*-
"""一个人的站点开关（命令行版）。

用法（在 backend 目录下）：
    .venv\\Scripts\\python.exe site_switch.py status
    .venv\\Scripts\\python.exe site_switch.py off
    .venv\\Scripts\\python.exe site_switch.py on

关站后，除了登录、健康检查和开关接口，其余 API 一律返回 503；
前端会自动显示维护页。这个命令不需要重启后端，也不消耗登录凭证。
"""
from __future__ import annotations

import argparse
import json

from app import site_state


def main() -> None:
    parser = argparse.ArgumentParser(description="明析 AI 站点开关")
    parser.add_argument("action", choices=["on", "off", "status"])
    parser.add_argument("-m", "--message", help="关站时给访客看的提示语")
    args = parser.parse_args()

    if args.action == "status":
        state = site_state.load_state()
    else:
        state = site_state.save_state(
            enabled=args.action == "on",
            message=args.message,
            updated_by="cli",
        )
    print(json.dumps(state, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
