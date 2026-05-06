from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func, extract, case
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Transaction, Category, FamilyMember, Tag, TagCategory, transaction_tags

router = APIRouter(prefix="/api/stats", tags=["stats"])


# ─── helpers ─────────────────────────────────────────────────────────────────

def _eff(type_: str):
    """有效金额：expense 类型扣除已报销部分，其他类型原值。"""
    if type_ == "expense":
        return case(
            (
                Transaction.is_reimbursable == True,  # noqa: E712
                case(
                    (Transaction.amount > Transaction.reimbursable_amount,
                     Transaction.amount - Transaction.reimbursable_amount),
                    else_=0,
                ),
            ),
            else_=Transaction.amount,
        )
    return Transaction.amount


def _pct(current: float, prev: float) -> Optional[float]:
    if prev == 0:
        return None
    return round((current - prev) / prev * 100, 1)


def _prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


async def _total(db: AsyncSession, year: int, month: int, type_: str) -> float:
    r = await db.execute(
        select(func.sum(_eff(type_))).where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type_,
        )
    )
    return float(r.scalar() or 0)


async def _cat_totals(db: AsyncSession, year: int, month: int, type_: str) -> dict[int, float]:
    r = await db.execute(
        select(Transaction.category_id, func.sum(_eff(type_)).label("total"))
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type_,
            Transaction.category_id.isnot(None),
        )
        .group_by(Transaction.category_id)
    )
    return {row[0]: float(row[1] or 0) for row in r.all()}


async def _fetch_cats_with_parents(db: AsyncSession, ids: set[int]) -> dict[int, Category]:
    if not ids:
        return {}
    r = await db.execute(select(Category).where(Category.id.in_(ids)))
    cats: dict[int, Category] = {c.id: c for c in r.scalars().all()}
    parent_ids = {c.parent_id for c in cats.values() if c.parent_id} - set(cats)
    if parent_ids:
        pr = await db.execute(select(Category).where(Category.id.in_(parent_ids)))
        for pc in pr.scalars().all():
            cats[pc.id] = pc
    return cats


def _to_top_level(cid: int, cats: dict[int, Category]) -> int:
    """Return the top-level ancestor id for a given category id."""
    cat = cats.get(cid)
    if cat and cat.parent_id and cat.parent_id in cats:
        return cat.parent_id
    return cid


def _aggregate_to_parents(totals: dict[int, float], cats: dict[int, Category]) -> dict[int, float]:
    result: dict[int, float] = {}
    for cid, t in totals.items():
        pid = _to_top_level(cid, cats)
        result[pid] = result.get(pid, 0) + t
    return result


# ─── schemas ─────────────────────────────────────────────────────────────────

class CompareValue(BaseModel):
    current: float
    prev_month: float
    prev_month_pct: Optional[float]
    prev_year: float
    prev_year_pct: Optional[float]


class MonthlySummaryStats(BaseModel):
    income: CompareValue
    expense: CompareValue
    balance: CompareValue


class CategoryChild(BaseModel):
    id: int
    name: str
    icon: str
    total: float
    percentage: float  # % of parent total


class CategoryBreakdownItem(BaseModel):
    id: int
    name: str
    icon: str
    total: float
    percentage: float  # % of grand total
    prev_month_pct: Optional[float]
    prev_year_pct: Optional[float]
    children: list[CategoryChild]


class MemberBreakdownItem(BaseModel):
    member_id: Optional[int]
    member_name: str
    member_avatar: str
    total: float
    percentage: float
    prev_month_pct: Optional[float]


class TagItem(BaseModel):
    tag_id: int
    tag_name: str
    tag_icon: str
    total: float
    percentage: float  # % of period total (multi-tag transactions counted per tag)


class TagBreakdownGroup(BaseModel):
    tag_category_id: int
    tag_category_name: str
    tag_category_icon: str
    total: float
    tags: list[TagItem]


class MerchantItem(BaseModel):
    counterparty: str
    total: float
    count: int
    percentage: float  # % of period total


class MonthlyTrend(BaseModel):
    month: int  # 1-12
    income: float
    expense: float
    balance: float


class AnnualCategoryItem(BaseModel):
    id: int
    name: str
    icon: str
    total: float
    percentage: float
    children: list[CategoryChild]


class AnnualMemberItem(BaseModel):
    member_id: Optional[int]
    member_name: str
    member_avatar: str
    total: float
    percentage: float


class AnnualReport(BaseModel):
    year: int
    trend: list[MonthlyTrend]
    categories: list[AnnualCategoryItem]
    members: list[AnnualMemberItem]


# ─── endpoints ───────────────────────────────────────────────────────────────

@router.get("/monthly-summary", response_model=MonthlySummaryStats)
async def monthly_summary(
    year: int = Query(...),
    month: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    py, pm = _prev_month(year, month)

    cur_inc = await _total(db, year, month, "income")
    pm_inc  = await _total(db, py, pm, "income")
    yy_inc  = await _total(db, year - 1, month, "income")

    cur_exp = await _total(db, year, month, "expense")
    pm_exp  = await _total(db, py, pm, "expense")
    yy_exp  = await _total(db, year - 1, month, "expense")

    cur_bal = cur_inc - cur_exp
    pm_bal  = pm_inc  - pm_exp
    yy_bal  = yy_inc  - yy_exp

    return MonthlySummaryStats(
        income=CompareValue(
            current=round(cur_inc, 2),
            prev_month=round(pm_inc, 2),
            prev_month_pct=_pct(cur_inc, pm_inc),
            prev_year=round(yy_inc, 2),
            prev_year_pct=_pct(cur_inc, yy_inc),
        ),
        expense=CompareValue(
            current=round(cur_exp, 2),
            prev_month=round(pm_exp, 2),
            prev_month_pct=_pct(cur_exp, pm_exp),
            prev_year=round(yy_exp, 2),
            prev_year_pct=_pct(cur_exp, yy_exp),
        ),
        balance=CompareValue(
            current=round(cur_bal, 2),
            prev_month=round(pm_bal, 2),
            prev_month_pct=_pct(cur_bal, pm_bal),
            prev_year=round(yy_bal, 2),
            prev_year_pct=_pct(cur_bal, yy_bal),
        ),
    )


@router.get("/category-breakdown", response_model=list[CategoryBreakdownItem])
async def category_breakdown(
    year: int = Query(...),
    month: int = Query(...),
    type: str = Query("expense"),
    db: AsyncSession = Depends(get_db),
):
    py, pm = _prev_month(year, month)

    cur    = await _cat_totals(db, year, month, type)
    prev_m = await _cat_totals(db, py, pm, type)
    prev_y = await _cat_totals(db, year - 1, month, type)

    all_ids = set(cur) | set(prev_m) | set(prev_y)
    if not all_ids:
        return []

    cats = await _fetch_cats_with_parents(db, all_ids)

    # Aggregate all periods to parent/top-level
    parent_cur  = _aggregate_to_parents(cur, cats)
    parent_pm   = _aggregate_to_parents(prev_m, cats)
    parent_py   = _aggregate_to_parents(prev_y, cats)

    # Build children list for the current period
    children_of: dict[int, list[dict]] = {}
    for cid, total in cur.items():
        cat = cats.get(cid)
        if cat and cat.parent_id and cat.parent_id in cats:
            children_of.setdefault(cat.parent_id, []).append({
                "id": cid,
                "name": cat.name,
                "icon": cat.icon,
                "total": round(total, 2),
            })

    grand_total = sum(parent_cur.values()) or 1

    result = []
    for pid, total in sorted(parent_cur.items(), key=lambda x: x[1], reverse=True):
        if total <= 0:
            continue
        cat = cats.get(pid)
        if cat is None:
            continue
        children_raw = sorted(children_of.get(pid, []), key=lambda x: x["total"], reverse=True)
        parent_total_nonzero = total or 1
        result.append(CategoryBreakdownItem(
            id=pid,
            name=cat.name,
            icon=cat.icon,
            total=round(total, 2),
            percentage=round(total / grand_total * 100, 1),
            prev_month_pct=_pct(total, parent_pm.get(pid, 0)),
            prev_year_pct=_pct(total, parent_py.get(pid, 0)),
            children=[
                CategoryChild(
                    id=c["id"],
                    name=c["name"],
                    icon=c["icon"],
                    total=c["total"],
                    percentage=round(c["total"] / parent_total_nonzero * 100, 1),
                )
                for c in children_raw
            ],
        ))

    return result


@router.get("/member-breakdown", response_model=list[MemberBreakdownItem])
async def member_breakdown(
    year: int = Query(...),
    month: int = Query(...),
    type: str = Query("expense"),
    db: AsyncSession = Depends(get_db),
):
    py, pm = _prev_month(year, month)

    eff = _eff(type)

    cur_r = await db.execute(
        select(Transaction.member_id, func.sum(eff).label("total"))
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
        )
        .group_by(Transaction.member_id)
    )
    cur_rows = {row[0]: float(row[1] or 0) for row in cur_r.all()}

    pm_r = await db.execute(
        select(Transaction.member_id, func.sum(eff).label("total"))
        .where(
            extract("year", Transaction.date) == py,
            extract("month", Transaction.date) == pm,
            Transaction.type == type,
        )
        .group_by(Transaction.member_id)
    )
    pm_rows = {row[0]: float(row[1] or 0) for row in pm_r.all()}

    all_members_r = await db.execute(
        select(FamilyMember).order_by(FamilyMember.sort_order, FamilyMember.id)
    )
    members_by_id = {m.id: m for m in all_members_r.scalars().all()}

    grand_total = sum(cur_rows.values()) or 1
    items: list[MemberBreakdownItem] = []

    # 未指定成员排第一
    if None in cur_rows:
        t = cur_rows[None]
        items.append(MemberBreakdownItem(
            member_id=None,
            member_name="未指定成员",
            member_avatar="👤",
            total=round(t, 2),
            percentage=round(t / grand_total * 100, 1),
            prev_month_pct=_pct(t, pm_rows.get(None, 0)),
        ))

    for mid, t in sorted(
        [(mid, t) for mid, t in cur_rows.items() if mid is not None],
        key=lambda x: x[1],
        reverse=True,
    ):
        m = members_by_id.get(mid)
        items.append(MemberBreakdownItem(
            member_id=mid,
            member_name=m.name if m else f"成员{mid}",
            member_avatar=m.avatar if m else "👤",
            total=round(t, 2),
            percentage=round(t / grand_total * 100, 1),
            prev_month_pct=_pct(t, pm_rows.get(mid, 0)),
        ))

    return items


@router.get("/tag-breakdown", response_model=list[TagBreakdownGroup])
async def tag_breakdown(
    year: int = Query(...),
    month: int = Query(...),
    type: str = Query("expense"),
    db: AsyncSession = Depends(get_db),
):
    # 获取本期每笔交易的有效金额
    txn_r = await db.execute(
        select(Transaction.id, _eff(type).label("eff"))
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
        )
    )
    txn_amounts: dict[int, float] = {row.id: float(row.eff or 0) for row in txn_r.all()}
    if not txn_amounts:
        return []

    all_total = sum(txn_amounts.values()) or 1

    # 获取标签关联
    tt_r = await db.execute(
        select(transaction_tags.c.tag_id, transaction_tags.c.transaction_id)
        .where(transaction_tags.c.transaction_id.in_(txn_amounts.keys()))
    )
    tag_totals: dict[int, float] = {}
    for row in tt_r.all():
        tag_totals[row.tag_id] = tag_totals.get(row.tag_id, 0) + txn_amounts.get(row.transaction_id, 0)

    if not tag_totals:
        return []

    # 获取 Tag + TagCategory 信息
    tags_r = await db.execute(
        select(Tag, TagCategory)
        .join(TagCategory, Tag.category_id == TagCategory.id)
        .where(Tag.id.in_(tag_totals.keys()))
        .order_by(TagCategory.sort_order, Tag.sort_order)
    )

    groups: dict[int, dict] = {}
    for tag, tc in tags_r.all():
        if tc.id not in groups:
            groups[tc.id] = {
                "tag_category_id": tc.id,
                "tag_category_name": tc.name,
                "tag_category_icon": tc.icon,
                "total": 0.0,
                "tags": [],
            }
        t = round(tag_totals.get(tag.id, 0), 2)
        groups[tc.id]["total"] = round(groups[tc.id]["total"] + t, 2)
        groups[tc.id]["tags"].append(TagItem(
            tag_id=tag.id,
            tag_name=tag.name,
            tag_icon=tag.icon,
            total=t,
            percentage=round(t / all_total * 100, 1),
        ))

    result = []
    for g in sorted(groups.values(), key=lambda x: x["total"], reverse=True):
        g["tags"].sort(key=lambda x: x.total, reverse=True)
        result.append(TagBreakdownGroup(
            tag_category_id=g["tag_category_id"],
            tag_category_name=g["tag_category_name"],
            tag_category_icon=g["tag_category_icon"],
            total=g["total"],
            tags=g["tags"],
        ))
    return result


@router.get("/top-merchants", response_model=list[MerchantItem])
async def top_merchants(
    year: int = Query(...),
    month: int = Query(...),
    type: str = Query("expense"),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    eff = _eff(type)

    # 本期总额（用于计算占比）
    total_r = await db.execute(
        select(func.sum(eff)).where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
        )
    )
    all_total = float(total_r.scalar() or 0) or 1

    r = await db.execute(
        select(
            Transaction.counterparty,
            func.sum(eff).label("total"),
            func.count(Transaction.id).label("cnt"),
        )
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
            Transaction.counterparty != "",
            Transaction.counterparty.isnot(None),
        )
        .group_by(Transaction.counterparty)
        .order_by(func.sum(eff).desc())
        .limit(limit)
    )

    return [
        MerchantItem(
            counterparty=row.counterparty,
            total=round(float(row.total or 0), 2),
            count=row.cnt,
            percentage=round(float(row.total or 0) / all_total * 100, 1),
        )
        for row in r.all()
        if float(row.total or 0) > 0
    ]


@router.get("/annual", response_model=AnnualReport)
async def annual_report(
    year: int = Query(...),
    type: str = Query("expense"),
    db: AsyncSession = Depends(get_db),
):
    eff_exp = _eff("expense")
    eff_inc = _eff("income")

    # Monthly trend
    trend_r = await db.execute(
        select(
            extract("month", Transaction.date).label("m"),
            func.sum(case((Transaction.type == "income", _eff("income")), else_=0)).label("inc"),
            func.sum(case((Transaction.type == "expense", eff_exp), else_=0)).label("exp"),
        )
        .where(extract("year", Transaction.date) == year)
        .group_by(extract("month", Transaction.date))
    )
    trend_by_month: dict[int, tuple[float, float]] = {}
    for row in trend_r.all():
        trend_by_month[int(row[0])] = (float(row[1] or 0), float(row[2] or 0))

    trend = [
        MonthlyTrend(
            month=m,
            income=round(trend_by_month.get(m, (0, 0))[0], 2),
            expense=round(trend_by_month.get(m, (0, 0))[1], 2),
            balance=round(trend_by_month.get(m, (0, 0))[0] - trend_by_month.get(m, (0, 0))[1], 2),
        )
        for m in range(1, 13)
    ]

    # Category totals for the requested type
    eff = _eff(type)
    cat_r = await db.execute(
        select(Transaction.category_id, func.sum(eff).label("total"))
        .where(
            extract("year", Transaction.date) == year,
            Transaction.type == type,
            Transaction.category_id.isnot(None),
        )
        .group_by(Transaction.category_id)
    )
    cat_totals: dict[int, float] = {row[0]: float(row[1] or 0) for row in cat_r.all()}

    all_cat_ids = set(cat_totals)
    cats = await _fetch_cats_with_parents(db, all_cat_ids)
    parent_totals = _aggregate_to_parents(cat_totals, cats)

    children_of: dict[int, list[dict]] = {}
    for cid, total in cat_totals.items():
        cat = cats.get(cid)
        if cat and cat.parent_id and cat.parent_id in cats:
            children_of.setdefault(cat.parent_id, []).append({
                "id": cid, "name": cat.name, "icon": cat.icon, "total": round(total, 2),
            })

    grand_total = sum(parent_totals.values()) or 1
    categories = []
    for pid, total in sorted(parent_totals.items(), key=lambda x: x[1], reverse=True):
        if total <= 0:
            continue
        cat = cats.get(pid)
        if cat is None:
            continue
        children_raw = sorted(children_of.get(pid, []), key=lambda x: x["total"], reverse=True)
        parent_nz = total or 1
        categories.append(AnnualCategoryItem(
            id=pid, name=cat.name, icon=cat.icon,
            total=round(total, 2),
            percentage=round(total / grand_total * 100, 1),
            children=[
                CategoryChild(id=c["id"], name=c["name"], icon=c["icon"],
                              total=c["total"], percentage=round(c["total"] / parent_nz * 100, 1))
                for c in children_raw
            ],
        ))

    # Member totals
    mem_r = await db.execute(
        select(Transaction.member_id, func.sum(eff).label("total"))
        .where(extract("year", Transaction.date) == year, Transaction.type == type)
        .group_by(Transaction.member_id)
    )
    mem_rows = {row[0]: float(row[1] or 0) for row in mem_r.all()}
    all_members_r = await db.execute(select(FamilyMember).order_by(FamilyMember.sort_order, FamilyMember.id))
    members_by_id = {m.id: m for m in all_members_r.scalars().all()}
    grand_mem = sum(mem_rows.values()) or 1

    members: list[AnnualMemberItem] = []
    if None in mem_rows:
        t = mem_rows[None]
        members.append(AnnualMemberItem(
            member_id=None, member_name="未指定成员", member_avatar="👤",
            total=round(t, 2), percentage=round(t / grand_mem * 100, 1),
        ))
    for mid, t in sorted([(k, v) for k, v in mem_rows.items() if k is not None], key=lambda x: x[1], reverse=True):
        m = members_by_id.get(mid)
        members.append(AnnualMemberItem(
            member_id=mid, member_name=m.name if m else f"成员{mid}",
            member_avatar=m.avatar if m else "👤",
            total=round(t, 2), percentage=round(t / grand_mem * 100, 1),
        ))

    return AnnualReport(year=year, trend=trend, categories=categories, members=members)
