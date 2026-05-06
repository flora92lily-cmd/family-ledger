"""行情定时刷新调度器 + 循环规则定时生成

策略：
- 每天 22:30（基金净值发布后）+ 次日 10:30（QDII 补刷）各跑一次
- 每天 00:05 处理循环记账规则，自动生成到期交易
- 开机时检查今日未刷新的持仓 + 未处理的循环规则，后台补漏（不阻塞启动）
- 失败静默记日志，不通知用户
"""
import asyncio
import calendar
import json
import logging
from datetime import date, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.database import async_session
from app.models import Holding, Account, AccountSnapshot, HoldingSnapshot, RecurringRule, RecurringExecution, Transaction, transaction_tags
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


def _matches_today(rule: RecurringRule, today: date) -> bool:
    """判断规则是否应在今天执行"""
    if today < rule.start_date:
        return False

    if rule.recurrence_type == "weekly":
        # recurrence_day: 1=Monday, ..., 7=Sunday
        # Python isoweekday(): 1=Monday, 7=Sunday
        return today.isoweekday() == rule.recurrence_day

    if rule.recurrence_type == "monthly":
        target_day = rule.recurrence_day
        last_day = calendar.monthrange(today.year, today.month)[1]
        if target_day > last_day:
            return False  # 如 31 号在 2 月不触发
        return today.day == target_day

    return False


async def process_recurring_rules() -> None:
    """每日定时处理循环规则，生成到期交易"""
    today = date.today()
    logger.info("循环规则处理：开始检查 %s", today)

    async with async_session() as db:
        result = await db.execute(
            select(RecurringRule).where(
                RecurringRule.is_active == True,
                RecurringRule.start_date <= today,
            )
        )
        rules = result.scalars().all()

        created_count = 0
        for rule in rules:
            # 1. 检查结束条件
            if rule.end_type == "date" and rule.end_date and today > rule.end_date:
                rule.is_active = False
                continue
            if rule.end_type == "count" and rule.max_count and rule.executed_count >= rule.max_count:
                rule.is_active = False
                continue

            # 2. 检查今天是否匹配
            if not _matches_today(rule, today):
                continue

            # 3. 去重：检查今天是否已执行
            existing = await db.execute(
                select(RecurringExecution).where(
                    RecurringExecution.rule_id == rule.id,
                    RecurringExecution.target_date == today,
                )
            )
            if existing.scalar():
                continue

            # 4. 创建交易
            tag_ids = json.loads(rule.tag_ids_json or "[]")
            txn = Transaction(
                amount=rule.amount,
                type=rule.type,
                description=rule.description,
                date=today,
                source="recurring",
                category_id=rule.category_id,
                account_id=rule.account_id,
                to_account_id=rule.to_account_id,
                member_id=rule.member_id,
            )
            db.add(txn)
            await db.flush()

            # 设置标签
            from sqlalchemy import insert as sa_insert
            for tid in tag_ids:
                await db.execute(sa_insert(transaction_tags).values(
                    transaction_id=txn.id, tag_id=tid
                ))

            # 5. 记录执行
            execution = RecurringExecution(
                rule_id=rule.id,
                transaction_id=txn.id,
                target_date=today,
            )
            db.add(execution)

            # 6. 更新计数
            rule.executed_count = (rule.executed_count or 0) + 1
            if rule.end_type == "count" and rule.max_count and rule.executed_count >= rule.max_count:
                rule.is_active = False

            created_count += 1

        await db.commit()

    if created_count:
        logger.info("循环规则处理完成：生成 %d 笔交易", created_count)
    else:
        logger.info("循环规则处理完成：无到期规则")


async def startup_backfill_recurring() -> None:
    """开机补漏：处理今天尚未执行的循环规则（后台异步运行）"""
    today = date.today()
    try:
        async with async_session() as db:
            result = await db.execute(
                select(RecurringRule).where(
                    RecurringRule.is_active == True,
                    RecurringRule.start_date <= today,
                )
            )
            rules = result.scalars().all()

        pending = []
        for rule in rules:
            if not _matches_today(rule, today):
                continue
            if rule.end_type == "date" and rule.end_date and today > rule.end_date:
                continue
            if rule.end_type == "count" and rule.max_count and rule.executed_count >= rule.max_count:
                continue
            pending.append(rule)

        if not pending:
            logger.info("开机补漏（循环规则）：今天无待处理规则")
            return

        logger.info("开机补漏（循环规则）：发现 %d 条待处理规则", len(pending))
        # 复用主处理逻辑
        await process_recurring_rules()

    except Exception as e:
        logger.error("开机补漏（循环规则）异常: %s", e)


async def take_snapshots() -> tuple[int, int]:
    """每月 1 日 00:30 — 为所有账户和持仓生成月度快照"""
    from datetime import date as _date
    from sqlalchemy import func as sa_func, insert as sa_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from app.models import ReimbursementRecord

    today = _date.today()
    logger.info("资产快照：开始生成 %s", today)

    async with async_session() as db:
        # ── 账户快照 ──────────────────────────────────────────────────────
        acc_r = await db.execute(select(Account))
        accounts = acc_r.scalars().all()

        # 计算每个账户的流水 delta
        from sqlalchemy import case as sa_case
        from app.models import Transaction as Txn

        delta: dict[int, float] = {a.id: 0.0 for a in accounts}
        out_r = await db.execute(
            select(Txn.account_id, Txn.type, sa_func.sum(Txn.amount))
            .where(Txn.account_id.isnot(None))
            .group_by(Txn.account_id, Txn.type)
        )
        for aid, ttype, total in out_r:
            if ttype == "income":
                delta[aid] = delta.get(aid, 0) + float(total or 0)
            else:
                delta[aid] = delta.get(aid, 0) - float(total or 0)

        in_r = await db.execute(
            select(Txn.to_account_id, sa_func.sum(Txn.amount))
            .where(Txn.to_account_id.isnot(None), Txn.type == "transfer")
            .group_by(Txn.to_account_id)
        )
        for aid, total in in_r:
            delta[aid] = delta.get(aid, 0) + float(total or 0)

        reim_r = await db.execute(
            select(ReimbursementRecord.to_account_id, sa_func.sum(ReimbursementRecord.total_amount))
            .where(ReimbursementRecord.to_account_id.isnot(None))
            .group_by(ReimbursementRecord.to_account_id)
        )
        for aid, total in reim_r:
            delta[aid] = delta.get(aid, 0) + float(total or 0)

        # 投资理财账户持仓市值
        holding_val: dict[int, float] = {}
        invest_ids = [a.id for a in accounts if a.category == "投资理财"]
        if invest_ids:
            hv_r = await db.execute(
                select(Holding.account_id, sa_func.sum(Holding.current_value))
                .where(Holding.account_id.in_(invest_ids))
                .group_by(Holding.account_id)
            )
            for aid, total in hv_r:
                if aid is not None:
                    holding_val[aid] = float(total or 0)

        for a in accounts:
            if a.category == "投资理财":
                cb = round(holding_val.get(a.id, 0), 2)
            else:
                cb = round(a.balance + delta.get(a.id, 0) + holding_val.get(a.id, 0), 2)
            try:
                await db.execute(
                    sqlite_insert(AccountSnapshot).values(
                        account_id=a.id, snapshot_date=today, balance=cb
                    ).on_conflict_do_nothing()
                )
            except Exception as e:
                logger.warning("账户快照写入失败 [%s]: %s", a.name, e)

        # ── 持仓快照 ──────────────────────────────────────────────────────
        h_r = await db.execute(select(Holding))
        holdings = h_r.scalars().all()
        for h in holdings:
            try:
                await db.execute(
                    sqlite_insert(HoldingSnapshot).values(
                        holding_id=h.id,
                        snapshot_date=today,
                        shares=h.shares,
                        price=h.current_price,
                        value=h.current_value,
                        cost_total=round(h.shares * h.cost_price, 2),
                    ).on_conflict_do_nothing()
                )
            except Exception as e:
                logger.warning("持仓快照写入失败 [%s]: %s", h.name, e)

        await db.commit()

    logger.info("资产快照完成：%d 个账户，%d 个持仓", len(accounts), len(holdings))
    return len(accounts), len(holdings)


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

    # 每天 00:05 — 处理循环记账规则
    scheduler.add_job(
        process_recurring_rules,
        CronTrigger(hour=0, minute=5, timezone=tz),
        id="recurring_rules_0005",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # 每月 1 日 00:30 — 生成资产快照
    scheduler.add_job(
        take_snapshots,
        CronTrigger(day=1, hour=0, minute=30, timezone=tz),
        id="asset_snapshots_monthly",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    return scheduler
