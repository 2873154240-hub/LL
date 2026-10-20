# -*- coding: utf-8 -*-
"""站点开关接口。

- `GET /api/site/status` 公开，前端据此显示维护页；
- `/api/owner/site` 只有 OWNER_EMAIL 对应的账号能调用。

开关状态存在 data/site_state.json，CLI 也能直接改，
所以「一个人的开关」不依赖登录、不依赖数据库。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import site_state
from ..config import OWNER_EMAIL
from ..deps import get_current_user
from ..models import User

router = APIRouter(tags=["site"])


class SiteToggleIn(BaseModel):
    enabled: bool
    message: str | None = Field(default=None, max_length=200)


def require_owner(user: User = Depends(get_current_user)) -> User:
    if not OWNER_EMAIL:
        raise HTTPException(503, "未配置 OWNER_EMAIL，请先在后端 .env 中设置站点所有者")
    if not user.is_owner:
        raise HTTPException(403, "只有站点所有者可以操作这个开关")
    return user


@router.get("/api/site/status")
def public_status():
    """公开状态：只暴露开关和提示语，不泄露所有者邮箱。"""
    state = site_state.load_state()
    return {
        "enabled": state["enabled"],
        "message": state["message"],
        "updated_at": state["updated_at"],
    }


@router.get("/api/owner/site")
def owner_status(user: User = Depends(require_owner)):
    return site_state.load_state()


@router.post("/api/owner/site")
def owner_toggle(body: SiteToggleIn, user: User = Depends(require_owner)):
    return site_state.save_state(
        enabled=body.enabled,
        message=body.message,
        updated_by=user.email,
    )
