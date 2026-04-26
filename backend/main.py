import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
