# -*- coding: utf-8 -*-
"""注册 / 登录 / 验证码 / 找回密码 / 当前用户。"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import CODE_TTL_SECONDS, DEV_RETURN_CODE, FREE_TOKENS_PER_DAY
from ..db import get_db
from ..deps import get_current_user
from ..models import EmailCode, User, utcnow
from ..schemas import AuthOut, LoginIn, RegisterIn, ResetPasswordIn, SendCodeIn, UserOut
from ..security import (
    create_access_token,
    generate_numeric_code,
    hash_password,
    verify_password,
)
from ..services import mailer, wallet

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/send-code")
def send_code(body: SendCodeIn, db: Session = Depends(get_db)):
    # 60 秒内不允许重复发送，防止刷短信/邮件
    last = db.scalars(
        select(EmailCode)
        .where(EmailCode.email == body.email)
        .order_by(EmailCode.created_at.desc())
        .limit(1)
    ).first()
    if last and (utcnow() - last.created_at).total_seconds() < 60:
        raise HTTPException(429, "发送过于频繁，请稍后再试")

    code = generate_numeric_code(6)
    record = EmailCode(
        email=body.email,
        code=code,
        purpose=body.purpose,
        expires_at=utcnow() + timedelta(seconds=CODE_TTL_SECONDS),
    )
    db.add(record)
    db.commit()

    sent = mailer.send_code(body.email, code, body.purpose)
    payload = {"ok": True, "sent": sent, "ttl": CODE_TTL_SECONDS}
    if not sent and DEV_RETURN_CODE:
        payload["dev_code"] = code
    return payload


def _verify_code(db: Session, email: str, code: str, purpose: str) -> None:
    record = db.scalars(
        select(EmailCode)
        .where(
            EmailCode.email == email,
            EmailCode.code == code,
            EmailCode.purpose == purpose,
            EmailCode.used.is_(False),
            EmailCode.expires_at > utcnow(),
        )
        .order_by(EmailCode.created_at.desc())
        .limit(1)
    ).first()
    if record is None:
        raise HTTPException(400, "验证码无效或已过期")
    record.used = True


@router.post("/register", response_model=AuthOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.scalars(select(User).where(User.email == body.email)).first():
        raise HTTPException(409, "该邮箱已注册")

    _verify_code(db, body.email, body.code, "register")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        nickname=body.email.split("@")[0][:16],
        free_token_date=utcnow().date().isoformat(),
        free_token_used=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.email == body.email)).first()
    if user is None or not verify_password(body.password, user.password_hash):
        # 不区分「邮箱不存在」和「密码错误」，避免账号枚举
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "邮箱或密码错误")
    wallet.reset_daily(user)
    db.commit()
    db.refresh(user)
    return AuthOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    wallet.reset_daily(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/reset-password")
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.email == body.email)).first()
    if user is None:
        raise HTTPException(404, "账号不存在")
    _verify_code(db, body.email, body.code, "reset")
    user.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


@router.get("/quota")
def quota(user: User = Depends(get_current_user)):
    """前端用来显示「今日免费额度 / 付费余额」"""
    return {
        "free_remaining": wallet.free_remaining(user),
        "free_per_day": FREE_TOKENS_PER_DAY,
        "paid_balance": user.token_balance,
        "available": wallet.available(user),
    }
