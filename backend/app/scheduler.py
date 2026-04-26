"""行情定时刷新调度器

策略：
- 每天 22:30（基金净值发布后）+ 次日 10:30（QDII 补刷）各跑一次
- 开机时检查今日未刷新的持仓，后台补漏（不阻塞启动）
- 失败静默记日志，不通知用户
"""
import asyncio
import logging
from datetime import date, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.database import async_session
from app.models import Holding
from app.price_service import fetch_price

logger = logging.getLogger(__name__)


async def _refresh_holdings(holdings: list) -> tuple[int, int]:
    """刷新传入的持仓列表，返回 (updated, failed)"""
    updated = failed = 0
    async with async_session() as db:
        # 在同一 session 内重新加载，避免跨 session 使用 detached 对象
        ids = [h.id for h in holdings]
        result = await db.execute(select(Holding).where(Holding.id.in_(ids)))
        rows = result.scalars().all()
        for h in rows:
            if not h.code:
                continue
            try:
                data = await fetch_price(h.asset_type, h.code)
                if data:
                    h.current_price = data["price"]
                    h.current_value = round(h.shares * h.current_price, 2)
                    h.price_updated_at = datetime.now()
                    updated += 1
            except Exception as e:
                logger.warning("行情刷新失败 [%s %s]: %s", h.asset_type, h.name, e)
                failed += 1
        await db.commit()
    return updated, failed


async def refresh_prices_job() -> None:
    """定时任务：批量刷新所有基金/股票行情"""
    logger.info("定时行情刷新：开始")
    async with async_session() as db:
        result = await db.execute(
            select(Holding).where(Holding.asset_type.in_(["fund", "stock"]))
        )
        holdings = result.scalars().all()

    if not holdings:
        logger.info("定时行情刷新：无持仓，跳过")
        return

    updated, failed = await _refresh_holdings(holdings)
    logger.info("定时行情刷新完成：更新 %d 个，失败 %d 个", updated, failed)


async def startup_backfill() -> None:
    """开机补漏：刷新今天还未更新行情的持仓（后台异步运行）"""
    today = date.today()
    try:
        async with async_session() as db:
            result = await db.execute(
                select(Holding).where(Holding.asset_type.in_(["fund", "stock"]))
            )
            all_holdings = result.scalars().all()

        need = [
            h for h in all_holdings
            if h.code and (
                h.price_updated_at is None
                or h.price_updated_at.date() < today
            )
        ]

        if not need:
            logger.info("开机补漏：所有持仓行情已是今日最新，跳过")
            return

        logger.info("开机补漏：发现 %d 个持仓需要更新", len(need))
        updated, failed = await _refresh_holdings(need)
        logger.info("开机补漏完成：更新 %d/%d 个，失败 %d 个", updated, len(need), failed)

    except Exception as e:
        logger.error("开机补漏异常: %s", e)


def create_scheduler() -> AsyncIOScheduler:
    """创建并配置 APScheduler（AsyncIOScheduler，Asia/Shanghai 时区）"""
    tz = "Asia/Shanghai"
    scheduler = AsyncIOScheduler(timezone=tz)

    # 22:30 — 基金净值通常在 22:00 左右发布
    scheduler.add_job(
        refresh_prices_job,
        CronTrigger(hour=22, minute=30, timezone=tz),
        id="price_refresh_2230",
        replace_existing=True,
        misfire_grace_time=300,   # 允许 5 分钟内的错过任务补跑
    )

    # 次日 10:30 — 覆盖 QDII / 隔夜更新的基金
    scheduler.add_job(
        refresh_prices_job,
        CronTrigger(hour=10, minute=30, timezone=tz),
        id="price_refresh_1030",
        replace_existing=True,
        misfire_grace_time=300,
    )

    return scheduler
