FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 境内服务器访问 npm 官方源不稳定，使用国内镜像构建前端。
RUN npm config set registry https://registry.npmmirror.com

# 先复制依赖清单，以便未修改依赖时复用 Docker 层缓存。
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim AS runtime

WORKDIR /app

# 使用国内 PyPI 镜像；运行镜像不再通过 apt/NodeSource 安装 Node.js。
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn

# 先安装 Python 依赖，以便业务代码变更时复用 Docker 层缓存。
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./backend/dist

RUN mkdir -p /data

EXPOSE 8080

CMD sh -c "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --app-dir backend"
