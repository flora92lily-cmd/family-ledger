"""家庭成员 CRUD

家庭成员是 Transaction / Account / Holding 的归属主体（一等模型）。
member_id FK 全部允许 NULL（未指定 / 共有），删除前需要确保无引用。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models import FamilyMember, Transaction, Account, Holding
from app.schemas import FamilyMemberCreate, FamilyMemberUpdate, FamilyMemberOut

router = APIRouter(prefix="/api/members", tags=["family members"])


@router.get("/", response_model=list[FamilyMemberOut])
async def list_members(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FamilyMember).order_by(FamilyMember.sort_order, FamilyMember.id)
    )
    return result.scalars().all()


@router.post("/", response_model=FamilyMemberOut)
async def create_member(data: FamilyMemberCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(FamilyMember).where(FamilyMember.name == data.name))
    if existing.scalar():
        raise HTTPException(status_code=409, detail=f"成员「{data.name}」已存在")
    member = FamilyMember(**data.model_dump())
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.put("/{member_id}", response_model=FamilyMemberOut)
async def update_member(member_id: int, data: FamilyMemberUpdate, db: AsyncSession = Depends(get_db)):
    member = await db.get(FamilyMember, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")
    if data.name != member.name:
        existing = await db.execute(select(FamilyMember).where(FamilyMember.name == data.name))
        if existing.scalar():
            raise HTTPException(status_code=409, detail=f"成员「{data.name}」已存在")
    member.name = data.name
    member.avatar = data.avatar
    member.sort_order = data.sort_order
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{member_id}")
async def delete_member(member_id: int, db: AsyncSession = Depends(get_db)):
    member = await db.get(FamilyMember, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    # 引用检查：删除前确保无 Transaction/Account/Holding 仍归属该成员
    txn_count = (await db.execute(
        select(func.count()).select_from(Transaction).where(Transaction.member_id == member_id)
    )).scalar() or 0
    acc_count = (await db.execute(
        select(func.count()).select_from(Account).where(Account.member_id == member_id)
    )).scalar() or 0
    hold_count = (await db.execute(
        select(func.count()).select_from(Holding).where(Holding.member_id == member_id)
    )).scalar() or 0

    refs = []
    if txn_count: refs.append(f"{txn_count} 笔账单")
    if acc_count: refs.append(f"{acc_count} 个账户")
    if hold_count: refs.append(f"{hold_count} 个持仓")
    if refs:
        raise HTTPException(
            status_code=400,
            detail=f"成员仍被 {' / '.join(refs)} 引用，请先改归属或删除这些记录"
        )

    await db.delete(member)
    await db.commit()
    return {"ok": True}
