# -*- coding: utf-8 -*-
"""FastAPI 入口。

启动：uvicorn app.main:app --reload --port 8322
文档：http://localhost:8322/docs
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import site_state
from .config import ANALYSIS_COST, CORS_ORIGINS, FREE_TOKENS_PER_DAY, LLM_API_KEY
from .db import init_db
from .routers import analysis, auth, billing, market, site


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()          # 首次启动自动建表
    yield


# 再在导入时建一次：FastAPI 的 lifespan 只在真正启动服务时触发，
# 而 TestClient(app) 不带上下文、或别人直接 `import app.main` 时不会触发，
# 结果就是「服务能跑、脚本一跑就 no such table」。create_all 本身幂等，多调一次无副作用。
init_db()


app = FastAPI(
    title="明析 AI · 决策研究台",
    description="标的 AI 自主研究引擎（研究参考，不构成投资建议）",
    version="1.0.0",
    lifespan=lifespan,
)

# 关站后仍然放行的路径：
# - 健康检查：部署平台/监控要知道进程还活着
# - 站点状态：前端据此显示维护页
# - 登录/当前用户：所有者要能登录后把站重新打开
_OPEN_WHEN_OFF = {
    "/api/health",
    "/api/site/status",
    "/api/auth/login",
    "/api/auth/me",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/docs/oauth2-redirect",
}
# /site 是纯 HTML 版前端：关站时也要能加载，否则访客只会看到一段 JSON，
# 看不到维护提示，也没法让所有者从页面重新开启。
_OPEN_PREFIX_WHEN_OFF = ("/api/owner/", "/site")


@app.middleware("http")
async def site_switch(request: Request, call_next):
    """一个人控制的营业开关：关站时除白名单外一律 503。

    状态从文件读取而不是缓存在内存里，所以 owner 在网页上或命令行
    切换后立刻生效，不需要重启服务。
    """
    if request.method == "OPTIONS":          # CORS 预检永远放行
        return await call_next(request)

    path = request.url.path
    allowed = path in _OPEN_WHEN_OFF or path.startswith(_OPEN_PREFIX_WHEN_OFF)
    if not allowed and not site_state.is_enabled():
        state = site_state.load_state()
        return JSONResponse(
            status_code=503,
            content={"detail": state["message"], "code": "site_disabled"},
        )
    return await call_next(request)


# 注意顺序：先加拦截器、后加 CORS，CORS 才会在最外层，
# 关站返回的 503 响应也带跨域头，浏览器才能读到提示语。
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(market.router)
app.include_router(analysis.router)
app.include_router(billing.router)
app.include_router(site.router)


# 纯 HTML 版前端（无构建步骤）。目录不存在时跳过，保证后端可独立部署。
_STATIC_SITE_DIR = Path(__file__).resolve().parents[2] / "web" / "public" / "site"
if _STATIC_SITE_DIR.is_dir():
    app.mount("/site", StaticFiles(directory=str(_STATIC_SITE_DIR), html=True), name="site")

# React 版前端（构建产物 web/dist）。单容器部署时由后端直接托管：
# 静态资源走 /assets，SPA 路由（/history、/me 等）回退到 index.html。
_DIST_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"
if _DIST_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets")), name="assets")


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "mingxi-ai",
        "llm_enabled": bool(LLM_API_KEY),
        "analysis_cost": ANALYSIS_COST,
        "free_tokens_per_day": FREE_TOKENS_PER_DAY,
    }


# SPA fallback：必须放在所有具体路由之后，避免抢先匹配 /api/* 等路径。
if _DIST_DIR.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    async def spa_fallback(path: str):
        # 具体 /api、/assets、/site、docs 等路由已在上方优先匹配；
        # 走到这里的是未命中的路径，其中 /api/* 视为不存在，其余回退到前端 index.html。
        if path.startswith(("api/", "assets/", "site/", "docs", "redoc", "openapi.json")):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        index = _DIST_DIR / "index.html"
        return FileResponse(index) if index.exists() else JSONResponse(
            status_code=404, content={"detail": "Not Found"}
        )
