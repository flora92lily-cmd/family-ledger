"""持仓管理接口"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert, delete as sa_delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models import Holding, Tag, holding_tags
from app.price_service import fetch_price
from app.schemas import TagBrief, FamilyMemberBrief

router = APIRouter(prefix="/api/holdings", tags=["holdings"])


class HoldingCreate(BaseModel):
    name: str
    code: str = ""
    asset_type: str  # "fund" | "stock" | "wealth"
    shares: float = 0
    cost_price: float = 0
    current_price: float = 0
    current_value: float = 0
    account_id: Optional[int] = None
    member_id: Optional[int] = None
    note: str = ""
    tag_ids: list[int] = []


class HoldingOut(BaseModel):
    id: int
    name: str
    code: str
    asset_type: str
    shares: float
    cost_price: float
    current_price: float
    current_value: float
    account_id: Optional[int]
    member_id: Optional[int] = None
    note: str
    price_updated_at: Optional[datetime]
    created_at: datetime
    member: Optional[FamilyMemberBrief] = None
    tags: list[TagBrief] = []

    # 计算字段
    cost_total: float = 0
    gain: float = 0
    gain_rate: float = 0

    model_config = {"from_attributes": True}


async def _set_tags(holding_id: int, tag_ids: list[int], db: AsyncSession):
    """设置持仓标签（直接操作关联表，避免 lazy load MissingGreenlet 错误）"""
    await db.execute(sa_delete(holding_tags).where(holding_tags.c.holding_id == holding_id))
    for tid in tag_ids:
        await db.execute(sa_insert(holding_tags).values(holding_id=holding_id, tag_id=tid))


def _enrich(h: Holding) -> HoldingOut:
    cost_total = round(h.shares * h.cost_price, 2)
    gain = round(h.current_value - cost_total, 2)
    gain_rate = round(gain / cost_total * 100, 2) if cost_total else 0
    out = HoldingOut.model_validate(h)
    out.cost_total = cost_total
    out.gain = gain
    out.gain_rate = gain_rate
    return out


def _base_query():
    return (
        select(Holding)
        .options(selectinload(Holding.member), selectinload(Holding.tags))
        .order_by(Holding.created_at)
    )


@router.get("/", response_model=list[HoldingOut])
async def list_holdings(
    member_id: int = None,  # 0 = 仅未指定（NULL）
    db: AsyncSession = Depends(get_db),
):
    query = _base_query()
    if member_id is not None:
        query = query.where(
            Holding.member_id.is_(None) if member_id == 0 else Holding.member_id == member_id
        )
    result = await db.execute(query)
    return [_enrich(h) for h in result.scalars().all()]


@router.post("/", response_model=HoldingOut)
async def create_holding(data: HoldingCreate, db: AsyncSession = Depends(get_db)):
    cv = data.current_value or round(data.shares * data.current_price, 2)
    h = Holding(
        name=data.name,
        code=data.code,
        asset_type=data.asset_type,
        shares=data.shares,
        cost_price=data.cost_price,
        current_price=data.current_price,
        current_value=cv,
        account_id=data.account_id,
        member_id=data.member_id,
        note=data.note,
    )
    db.add(h)
    await db.flush()
    await _set_tags(h.id, data.tag_ids, db)
    await db.commit()
    result = await db.execute(_base_query().where(Holding.id == h.id))
    return _enrich(result.scalar_one())


@router.put("/{hid}", response_model=HoldingOut)
async def update_holding(hid: int, data: HoldingCreate, db: AsyncSession = Depends(get_db)):
    h = await db.get(Holding, hid)
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    for k, v in data.model_dump(exclude={"tag_ids"}).items():
        setattr(h, k, v)
    h.current_value = h.current_value or round(h.shares * h.current_price, 2)
    await _set_tags(hid, data.tag_ids, db)
    await db.commit()
    result = await db.execute(_base_query().where(Holding.id == hid))
    return _enrich(result.scalar_one())


@router.delete("/{hid}")
async def delete_holding(hid: int, db: AsyncSession = Depends(get_db)):
    h = await db.get(Holding, hid)
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    await db.delete(h)
    await db.commit()
    return {"ok": True}


@router.post("/{hid}/refresh", response_model=HoldingOut)
async def refresh_price(hid: int, db: AsyncSession = Depends(get_db)):
    h = await db.get(Holding, hid)
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    if h.asset_type == "wealth":
        raise HTTPException(status_code=400, detail="银行理财请手动更新净值")

    try:
        result = await fetch_price(h.asset_type, h.code)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if result:
        h.current_price = result["price"]
        h.current_value = round(h.shares * h.current_price, 2)
        h.price_updated_at = datetime.now()
        await db.commit()

    result2 = await db.execute(_base_query().where(Holding.id == hid))
    return _enrich(result2.scalar_one())


@router.post("/refresh-all")
async def refresh_all_prices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Holding).where(Holding.asset_type.in_(["fund", "stock"]))
    )
    holdings = result.scalars().all()

    updated, failed = 0, []
    for h in holdings:
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
            failed.append({"name": h.name, "error": str(e)})

    await db.commit()
    return {"updated": updated, "failed": failed}


@router.get("/summary")
async def holdings_summary(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Holding))
    holdings = result.scalars().all()
    total_value = sum(h.current_value for h in holdings)
    total_cost = sum(h.shares * h.cost_price for h in holdings)
    total_gain = total_value - total_cost
    gain_rate = round(total_gain / total_cost * 100, 2) if total_cost else 0
    return {
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_gain": round(total_gain, 2),
        "gain_rate": gain_rate,
        "count": len(holdings),
    }
