# ---- 阶段 1：构建 React 前端 ----
FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- 阶段 2：后端 + 托管前端，单容器 ----
FROM python:3.11-slim AS runtime
WORKDIR /app

# 后端依赖
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# 后端代码
COPY backend/app backend/app

# 前端构建产物（由后端 FastAPI 直接托管）
COPY --from=web-build /app/web/dist web/dist

# 数据目录（SQLite）
RUN mkdir -p backend/data

EXPOSE 8322

# 生产：单进程 uvicorn，监听 0.0.0.0（PaaS 平台通常要求）
CMD ["sh", "-c", "cd backend && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8322}"]
