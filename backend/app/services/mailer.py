# -*- coding: utf-8 -*-
"""验证码投递。

没配 SMTP 时**不假装发送成功**：验证码直接打到控制台，并在接口响应里
带一个 dev_code 字段（前端的开发模式会把它显示出来）。这样本地能完整跑通
注册/找回密码，同时一眼能看出「这是开发模式，生产必须配 SMTP」。
"""
from __future__ import annotations

import logging
import smtplib
from email.header import Header
from email.mime.text import MIMEText

from ..config import SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER

log = logging.getLogger(__name__)


def send_code(email: str, code: str, purpose: str) -> bool:
    """返回是否真的发出去了。False 表示当前是开发模式。"""
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD):
        log.warning("[开发模式] %s 验证码 %s（purpose=%s）", email, code, purpose)
        print(f"\n[开发模式] 发给 {email} 的验证码: {code}\n", flush=True)
        return False

    title = "注册验证码" if purpose == "register" else "重置密码验证码"
    body = f"您的{title}是：{code}\n\n5 分钟内有效。如非本人操作请忽略。"
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(f"明析 AI - {title}", "utf-8")
    msg["From"] = SMTP_USER
    msg["To"] = email

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, [email], msg.as_string())
        return True
    except Exception as exc:
        log.error("邮件发送失败: %s", exc)
        return False
