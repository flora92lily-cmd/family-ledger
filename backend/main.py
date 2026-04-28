import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.database import init_db, async_session
from app.routers import categories, transactions, imports, holdings, accounts
from app.routers import tags, reimbursements, members
from app.seed import seed_defaults
from app.scheduler import create_scheduler, startup_backfill


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


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# 托管 React 前端（生产环境，dist/ 存在时生效）
_dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")
    app.mount("/icons", StaticFiles(directory=os.path.join(_dist, "icons")), name="icons")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # 如果请求的是实际存在的文件（如 manifest.json、favicon.svg），直接返回
        file_path = os.path.join(_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # 否则返回 index.html（SPA 路由）
        return FileResponse(os.path.join(_dist, "index.html"))
