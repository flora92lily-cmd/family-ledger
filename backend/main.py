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
# StaticFiles(html=True) 会直接返回存在的文件（manifest.json、图标等），
# 找不到时自动回退到 index.html，完整支持 SPA 路由。
# API 路由在上方已注册，优先级高于此挂载点，不会被拦截。
_dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="static")
