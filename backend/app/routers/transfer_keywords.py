"""对手方转账关键词 CRUD

业务：账单 counterparty 含某个关键词（substring）→ 自动识别为 transfer，
预填 to_account_id（若关键词配置了目标账户）。全 source 生效。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models import TransferKeyword
from app.schemas import TransferKeywordCreate, TransferKeywordUpdate, TransferKeywordOut

router = APIRouter(prefix="/api/transfer-keywords", tags=["transfer-keywords"])


@router.get("/", response_model=list[TransferKeywordOut])
async def list_keywords(db: AsyncSession = Depends(get_db)):
    """按 last_used_at desc（null 排后）、created_at desc 排序"""
    result = await db.execute(
        select(TransferKeyword)
        .options(selectinload(TransferKeyword.to_account))
        .order_by(
            TransferKeyword.last_used_at.is_(None),  # 非空在前
            TransferKeyword.last_used_at.desc(),
            TransferKeyword.created_at.desc(),
        )
    )
    return result.scalars().all()


@router.post("/", response_model=TransferKeywordOut)
async def create_keyword(data: TransferKeywordCreate, db: AsyncSession = Depends(get_db)):
    keyword = (data.keyword or "").strip()
    if not keyword:
        raise HTTPException(status_code=400, detail="keyword 不能为空")
    # 唯一性检查
    existing = (await db.execute(
        select(TransferKeyword).where(TransferKeyword.keyword == keyword)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"关键词 '{keyword}' 已存在")
    kw = TransferKeyword(
        keyword=keyword,
        to_account_id=data.to_account_id,
        note=(data.note or "").strip(),
    )
    db.add(kw)
    await db.commit()
    await db.refresh(kw)
    # 重新读出，带 selectinload 关联
    result = await db.execute(
        select(TransferKeyword)
        .options(selectinload(TransferKeyword.to_account))
        .where(TransferKeyword.id == kw.id)
    )
    return result.scalar_one()


@router.patch("/{kw_id}", response_model=TransferKeywordOut)
async def update_keyword(kw_id: int, data: TransferKeywordUpdate, db: AsyncSession = Depends(get_db)):
    kw = await db.get(TransferKeyword, kw_id)
    if not kw:
        raise HTTPException(status_code=404, detail="关键词不存在")
    if data.keyword is not None:
        new_kw = data.keyword.strip()
        if not new_kw:
            raise HTTPException(status_code=400, detail="keyword 不能为空")
        if new_kw != kw.keyword:
            dup = (await db.execute(
                select(TransferKeyword).where(TransferKeyword.keyword == new_kw)
            )).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail=f"关键词 '{new_kw}' 已存在")
            kw.keyword = new_kw
    if data.to_account_id is not None or "to_account_id" in data.model_fields_set:
        kw.to_account_id = data.to_account_id
    if data.note is not None:
        kw.note = data.note.strip()
    await db.commit()
    # 重新读出带关联
    result = await db.execute(
        select(TransferKeyword)
        .options(selectinload(TransferKeyword.to_account))
        .where(TransferKeyword.id == kw_id)
    )
    return result.scalar_one()


@router.delete("/{kw_id}")
async def delete_keyword(kw_id: int, db: AsyncSession = Depends(get_db)):
    kw = await db.get(TransferKeyword, kw_id)
    if not kw:
        raise HTTPException(status_code=404, detail="关键词不存在")
    await db.delete(kw)
    await db.commit()
    return {"ok": True}
