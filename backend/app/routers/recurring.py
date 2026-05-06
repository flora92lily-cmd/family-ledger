import calendar
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import RecurringRule, RecurringExecution, Transaction, transaction_tags
from app.schemas import (
    RecurringRuleCreate, RecurringRuleUpdate, RecurringRuleOut,
    RecurringExecutionOut,
)

router = APIRouter(prefix="/api/recurring-rules", tags=["recurring-rules"])


def _parse_tag_ids(rule: RecurringRule) -> list[int]:
    try:
        return json.loads(rule.tag_ids_json or "[]")
    except (json.JSONDecodeError, TypeError):
        return []


@router.get("/", response_model=list[RecurringRuleOut])
async def list_rules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RecurringRule)
        .options(
            selectinload(RecurringRule.category),
            selectinload(RecurringRule.account),
            selectinload(RecurringRule.to_account),
            selectinload(RecurringRule.member),
        )
        .order_by(RecurringRule.created_at.desc())
    )
    rules = result.scalars().all()
    out = []
    for r in rules:
        d = RecurringRuleOut.model_validate(r)
        d.tag_ids = _parse_tag_ids(r)
        out.append(d)
    return out


@router.get("/{rule_id}", response_model=RecurringRuleOut)
async def get_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RecurringRule)
        .options(
            selectinload(RecurringRule.category),
            selectinload(RecurringRule.account),
            selectinload(RecurringRule.to_account),
            selectinload(RecurringRule.member),
        )
        .where(RecurringRule.id == rule_id)
    )
    r = result.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="规则不存在")
    d = RecurringRuleOut.model_validate(r)
    d.tag_ids = _parse_tag_ids(r)
    return d


@router.post("/", response_model=RecurringRuleOut, status_code=201)
async def create_rule(data: RecurringRuleCreate, db: AsyncSession = Depends(get_db)):
    _validate_rule(data)
    payload = data.model_dump(exclude={"tag_ids"})
    payload["tag_ids_json"] = json.dumps(data.tag_ids, ensure_ascii=False)
    rule = RecurringRule(**payload)
    db.add(rule)
    await db.flush()

    # 如果今天已满足条件，立即生成第一笔交易
    await _try_execute_today(rule, db)

    await db.commit()
    await db.refresh(rule)
    result = await db.execute(
        select(RecurringRule)
        .options(
            selectinload(RecurringRule.category),
            selectinload(RecurringRule.account),
            selectinload(RecurringRule.to_account),
            selectinload(RecurringRule.member),
        )
        .where(RecurringRule.id == rule.id)
    )
    r = result.scalar_one()
    d = RecurringRuleOut.model_validate(r)
    d.tag_ids = _parse_tag_ids(r)
    return d


@router.patch("/{rule_id}", response_model=RecurringRuleOut)
async def update_rule(rule_id: int, data: RecurringRuleUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RecurringRule)
        .options(
            selectinload(RecurringRule.category),
            selectinload(RecurringRule.account),
            selectinload(RecurringRule.to_account),
            selectinload(RecurringRule.member),
        )
        .where(RecurringRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")

    update_data = data.model_dump(exclude_unset=True)
    tag_ids = update_data.pop("tag_ids", None)

    if tag_ids is not None:
        rule.tag_ids_json = json.dumps(tag_ids, ensure_ascii=False)

    for key, value in update_data.items():
        setattr(rule, key, value)

    # 如果 end_type=count 且已经达到上限，自动停用
    if rule.end_type == "count" and rule.max_count and rule.executed_count >= rule.max_count:
        rule.is_active = False

    await db.flush()

    # 修改后如果今天满足条件且尚未执行，立即生成交易
    await _try_execute_today(rule, db)

    await db.commit()
    await db.refresh(rule)

    d = RecurringRuleOut.model_validate(rule)
    d.tag_ids = _parse_tag_ids(rule)
    return d


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RecurringRule).where(RecurringRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}


@router.get("/{rule_id}/executions", response_model=list[RecurringExecutionOut])
async def list_executions(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RecurringExecution)
        .where(RecurringExecution.rule_id == rule_id)
        .order_by(RecurringExecution.target_date.desc())
    )
    return result.scalars().all()


def _matches_today(rule: RecurringRule, today: date) -> bool:
    """判断规则是否应在今天执行（与 scheduler._matches_today 逻辑一致）"""
    if today < rule.start_date:
        return False
    if rule.recurrence_type == "weekly":
        return today.isoweekday() == rule.recurrence_day
    if rule.recurrence_type == "monthly":
        last_day = calendar.monthrange(today.year, today.month)[1]
        if rule.recurrence_day > last_day:
            return False
        return today.day == rule.recurrence_day
    return False


async def _try_execute_today(rule: RecurringRule, db: AsyncSession) -> int:
    """如果今天匹配规则，立即生成一笔交易。返回生成的交易数（0 或 1）"""
    today = date.today()

    if not rule.is_active:
        return 0
    if not _matches_today(rule, today):
        return 0

    # 去重
    existing = await db.execute(
        select(RecurringExecution).where(
            RecurringExecution.rule_id == rule.id,
            RecurringExecution.target_date == today,
        )
    )
    if existing.scalar():
        return 0

    # 创建交易
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

    for tid in tag_ids:
        await db.execute(sa_insert(transaction_tags).values(transaction_id=txn.id, tag_id=tid))

    execution = RecurringExecution(
        rule_id=rule.id,
        transaction_id=txn.id,
        target_date=today,
    )
    db.add(execution)
    rule.executed_count = (rule.executed_count or 0) + 1
    return 1


def _validate_rule(data: RecurringRuleCreate | RecurringRuleUpdate):
    if isinstance(data, RecurringRuleUpdate):
        rt = data.recurrence_type
        rd = data.recurrence_day
        et = data.end_type
    else:
        rt = data.recurrence_type
        rd = data.recurrence_day
        et = data.end_type

    if rt is not None and rt not in ("weekly", "monthly"):
        raise HTTPException(status_code=422, detail="recurrence_type 必须是 weekly 或 monthly")
    if rd is not None:
        if rt == "weekly" and not (1 <= rd <= 7):
            raise HTTPException(status_code=422, detail="weekly recurrence_day 必须在 1-7 之间")
        if rt == "monthly" and not (1 <= rd <= 31):
            raise HTTPException(status_code=422, detail="monthly recurrence_day 必须在 1-31 之间")
    if et is not None and et not in ("never", "date", "count"):
        raise HTTPException(status_code=422, detail="end_type 必须是 never、date 或 count")
