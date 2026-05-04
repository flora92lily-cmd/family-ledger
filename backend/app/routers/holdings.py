"""持仓管理接口"""
from datetime import datetime, date as Date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert, delete as sa_delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models import Holding, Tag, Transaction, holding_tags
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


class RedeemRequest(BaseModel):
    """赎回请求：从 holding 卖出 shares_reduced 份，钱进 to_account_id。
    自动拆账成 transfer（本金归位）+ income/expense（已实现盈亏）。"""
    to_account_id: int
    date: Date
    received_amount: float            # 实际到账金额（含盈亏）
    shares_reduced: float             # 赎回份额
    record_pnl: bool = True           # 是否单独记一笔盈亏交易
    pnl_category_id: Optional[int] = None  # 盈亏分类（用户在前端选）
    note: str = ""


@router.post("/{hid}/redeem")
async def redeem_holding(hid: int, data: RedeemRequest, db: AsyncSession = Depends(get_db)):
    """赎回持仓：自动拆 transfer + 已实现盈亏交易，更新 shares。"""
    h = await db.get(Holding, hid)
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")
    if data.shares_reduced <= 0:
        raise HTTPException(status_code=400, detail="赎回份额必须大于 0")
    if data.shares_reduced > h.shares + 1e-6:
        raise HTTPException(status_code=400, detail=f"赎回份额超出持仓 ({h.shares})")
    if data.received_amount < 0:
        raise HTTPException(status_code=400, detail="到账金额不能为负")
    if not h.account_id:
        raise HTTPException(status_code=400, detail="该持仓未绑定投资账户，无法赎回")

    cost_basis = round(h.cost_price * data.shares_reduced, 2)
    pnl = round(data.received_amount - cost_basis, 2)

    txn_transfer = Transaction(
        amount=cost_basis,
        type="transfer",
        description=f"赎回 {h.name}",
        date=data.date,
        source="manual",
        account_id=h.account_id,
        to_account_id=data.to_account_id,
    )
    db.add(txn_transfer)

    pnl_txn_id: Optional[int] = None
    if data.record_pnl and abs(pnl) > 0.005:
        pnl_txn = Transaction(
            amount=abs(pnl),
            type="income" if pnl > 0 else "expense",
            description=f"{h.name} 已实现{'盈利' if pnl > 0 else '亏损'}",
            date=data.date,
            source="manual",
            account_id=data.to_account_id,
            category_id=data.pnl_category_id,
        )
        db.add(pnl_txn)
        await db.flush()
        pnl_txn_id = pnl_txn.id

    h.shares = round(h.shares - data.shares_reduced, 6)
    if h.shares < 1e-6:
        h.shares = 0
    h.current_value = round(h.shares * h.current_price, 2)

    await db.commit()

    return {
        "ok": True,
        "cost_basis": cost_basis,
        "pnl": pnl,
        "transfer_amount": cost_basis,
        "pnl_txn_id": pnl_txn_id,
        "remaining_shares": h.shares,
    }


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
