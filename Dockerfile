FROM python:3.12-slim

# 安装 Node.js 20（用于构建前端）和 librsvg2-bin（用于 SVG→PNG 图标转换）
RUN apt-get update && apt-get install -y curl librsvg2-bin && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装前端依赖并构建
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/

# 从 SVG 生成 PWA 图标（192、512、180 三种尺寸）
RUN mkdir -p frontend/public/icons && \
    rsvg-convert -w 192 -h 192 frontend/public/app-icon.svg -o frontend/public/icons/icon-192.png && \
    rsvg-convert -w 512 -h 512 frontend/public/app-icon.svg -o frontend/public/icons/icon-512.png && \
    rsvg-convert -w 180 -h 180 frontend/public/app-icon.svg -o frontend/public/icons/icon-180.png

RUN cd frontend && npm run build

# 安装 Python 依赖
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# 复制后端代码
COPY backend/ ./backend/

# 将构建好的前端放入后端目录
RUN cp -r frontend/dist backend/dist

# 创建数据库持久化目录
RUN mkdir -p /data

EXPOSE 8080

CMD sh -c "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --app-dir backend"
