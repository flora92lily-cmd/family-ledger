import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.types import Scope
from app.database import init_db, async_session
from app.routers import categories, transactions, imports, holdings, accounts
from app.routers import tags, reimbursements, members, recurring, stats, transfer_keywords
from app.seed import seed_defaults
from app.scheduler import create_scheduler, startup_backfill, startup_backfill_recurring


class CacheControlledStaticFiles(StaticFiles):
    """根据文件类型设置不同 Cache-Control，确保 PWA 部署后能拿到最新版本。

    - index.html / manifest.json：每次都向服务器校验（no-cache）
    - /assets/*：Vite 输出带 hash，可永久缓存（immutable）
    - 其他（图标等无 hash 静态文件）：短缓存 1 小时
    """
    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            # SPA fallback：未匹配到的非 API 路径回退到 index.html，
            # 防止前端深层路由（/import、/add 等）刷新时拿到 FastAPI 的 JSON 404。
            # API 路由已在上方 include_router 注册，优先级高于本 mount，不会走到这里。
            index = os.path.join(self.directory, "index.html")
            if os.path.isfile(index):
                return FileResponse(index, headers={"Cache-Control": "no-cache, must-revalidate"})
        elif response.status_code == 200:
            if path in ("", "index.html", "manifest.json", "manifest.webmanifest") or path.endswith(".html"):
                response.headers["Cache-Control"] = "no-cache, must-revalidate"
            elif path.startswith("assets/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path == "sw.js" or path.startswith("workbox-"):
                response.headers["Cache-Control"] = "no-cache, must-revalidate"
            else:
                response.headers["Cache-Control"] = "public, max-age=3600"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with async_session() as db:
        await seed_defaults(db)

    # 启动定时行情刷新调度器
    scheduler = create_scheduler()
    scheduler.start()

    # 开机补漏：后台运行，不阻塞启动
    asyncio.create_task(startup_backfill())
    asyncio.create_task(startup_backfill_recurring())

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(title="Family Ledger", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tags.router)
app.include_router(members.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(imports.router)
app.include_router(holdings.router)
app.include_router(accounts.router)
app.include_router(reimbursements.router)
app.include_router(recurring.router)
app.include_router(stats.router)
app.include_router(transfer_keywords.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# 托管 React 前端（生产环境，dist/ 存在时生效）
# StaticFiles(html=True) 会直接返回存在的文件（manifest.json、图标等），
# 找不到时自动回退到 index.html，完整支持 SPA 路由。
# API 路由在上方已注册，优先级高于此挂载点，不会被拦截。
_dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
if os.path.isdir(_dist):
    app.mount("/", CacheControlledStaticFiles(directory=_dist, html=True), name="static")
