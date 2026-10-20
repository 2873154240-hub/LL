# -*- coding: utf-8 -*-
"""AI 研究：执行、历史、详情、删除。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..config import ANALYSIS_COST
from ..db import get_db
from ..deps import get_current_user
from ..models import Analysis, User
from ..schemas import AnalysisIn, AnalysisOut, AnalysisSummary
from ..services import market_data, research, wallet

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/cost")
def cost():
    return {"cost": ANALYSIS_COST}


@router.post("/run", response_model=AnalysisOut)
async def run(
    body: AnalysisIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    info = market_data.get_symbol_info(body.symbol)
    if info is None:
        raise HTTPException(404, "标的不存在")
    if info["market"] != body.market:
        raise HTTPException(400, "标的与市场不匹配")

    # 先扣费再研究；研究失败原路退回，避免用户为失败结果买单
    charge = wallet.consume(db, user, ANALYSIS_COST, "AI 研究", f"{body.symbol} {body.interval}")
    db.commit()

    try:
        data = await market_data.fetch_market(body.symbol, body.market, body.interval, limit=200)
        card = await research.run_research(data, body.model)
    except Exception as exc:
        wallet.grant(db, user, ANALYSIS_COST, "研究失败退款", str(exc)[:120])
        db.commit()
        raise HTTPException(503, f"研究失败：{exc}")

    record = Analysis(
        user_id=user.id,
        symbol=card["symbol"],
        market=card["market"],
        interval=card["interval"],
        model=card["model"],
        verdict=card["verdict"],
        price=card["price"],
        payload=card,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    out = AnalysisOut.model_validate(record)
    out.payload = {**card, "billing": charge}
    return out


@router.get("/history")
def history(
    q: str = "",
    symbol: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Analysis).where(Analysis.user_id == user.id)
    if symbol:
        stmt = stmt.where(Analysis.symbol == symbol.upper())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Analysis.symbol.like(like),
                Analysis.model.like(like),
                Analysis.interval.like(like),
                Analysis.verdict.like(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Analysis.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return {
        "total": total,
        "items": [AnalysisSummary.model_validate(r) for r in rows],
    }


@router.get("/{analysis_id}", response_model=AnalysisOut)
def detail(analysis_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Analysis, analysis_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "记录不存在")
    return AnalysisOut.model_validate(row)


@router.delete("/{analysis_id}")
def remove(analysis_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Analysis, analysis_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "记录不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("")
def clear(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(delete(Analysis).where(Analysis.user_id == user.id))
    db.commit()
    return {"ok": True}
