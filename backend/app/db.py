# -*- coding: utf-8 -*-
"""数据库连接与会话管理。

用 SQLite 是为了零部署：第一次启动自动建表，删掉 data/app.db 就完全重置。
表结构变动频繁的开发期，直接删库重建比写迁移脚本更快。
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL


class Base(DeclarativeBase):
    pass


# check_same_thread=False：FastAPI 的线程池会跨线程复用连接，SQLite 默认禁止
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    """FastAPI 依赖：每个请求一个会话，请求结束必定关闭"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401  导入才会注册表结构

    Base.metadata.create_all(bind=engine)
