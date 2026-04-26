"""报销管理接口

数据模型说明：
- Transaction 带报销字段：is_reimbursable / reimbursable_amount / reimbursement_status / external_id
- ReimbursementRecord：报销到账记录，通过 reimbursement_items 关联 N 笔原支出
- 报销款不是 Transaction，不走 income 类型；账户余额通过 /api/accounts 聚合时额外加上

流程：
1. 用户在记账时勾选「可报销」→ is_reimbursable=True, status=pending
2. 提交报销（选 N 笔待报销 + 填到账账户/日期/实收金额）→ 创建 ReimbursementRecord + 关联 + 原 txn status=done
3. 撤销报销 → 删除 ReimbursementRecord，被关联的 txn 回到 pending
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert, delete as sa_delete, update as sa_update
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models import (
    Transaction, ReimbursementRecord, Account, Category,
    reimbursement_items,
)
from app.schemas import (
    ReimbursementRecordCreate, ReimbursementRecordOut,
    ReimbursementItemOut, TransactionOut,
)

router = APIRouter(prefix="/api/reimbursements", tags=["reimbursements"])


async def _build_record_out(record: ReimbursementRecord, db: AsyncSession) -> dict:
    """把 ReimbursementRecord 组装成响应字典（含关联交易简要信息）"""
    # 查关联交易
    rows = await db.execute(
        select(
            reimbursement_items.c.transaction_id,
            reimbursement_items.c.amount,
            Transaction.date,
            Transaction.description,
            Transaction.amount.label("paid"),
            Category.name.label("cat_name"),
            Category.icon.label("cat_icon"),
        )
        .select_from(reimbursement_items)
        .join(Transaction, Transaction.id == reimbursement_items.c.transaction_id)
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(reimbursement_items.c.record_id == record.id)
    )
    items = []
    for r in rows:
        items.append(ReimbursementItemOut(
            transaction_id=r.transaction_id,
            amount=r.amount,
            date=r.date,
            description=r.description or "",
            category_name=r.cat_name,
            category_icon=r.cat_icon,
            amount_paid=r.paid,
        ))

    to_account = None
    if record.to_account_id:
        acc = await db.get(Account, record.to_account_id)
        if acc:
            to_account = {
                "id": acc.id,
                "name": acc.name,
                "icon": acc.icon,
                "category": acc.category,
            }

    return {
        "id": record.id,
        "date": record.date,
        "to_account_id": record.to_account_id,
        "total_amount": record.total_amount,
        "note": record.note or "",
        "source": record.source or "manual",
        "external_id": record.external_id or "",
        "created_at": record.created_at,
        "to_account": to_account,
        "items": items,
    }


@router.get("/pending", response_model=list[TransactionOut])
async def list_pending(db: AsyncSession = Depends(get_db)):
    """列出所有待报销的支出（is_reimbursable=True 且 status=pending）"""
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.account),
            selectinload(Transaction.to_account),
            selectinload(Transaction.tags),
        )
        .where(
            Transaction.is_reimbursable == True,  # noqa: E712
            Transaction.reimbursement_status == "pending",
        )
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    )
    return result.scalars().all()


@router.get("/", response_model=list[ReimbursementRecordOut])
async def list_records(db: AsyncSession = Depends(get_db)):
    """列出所有已生成的报销记录"""
    result = await db.execute(
        select(ReimbursementRecord).order_by(
            ReimbursementRecord.date.desc(),
            ReimbursementRecord.id.desc(),
        )
    )
    records = result.scalars().all()
    return [await _build_record_out(r, db) for r in records]


@router.get("/{record_id}", response_model=ReimbursementRecordOut)
async def get_record(record_id: int, db: AsyncSession = Depends(get_db)):
    record = await db.get(ReimbursementRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="报销记录不存在")
    return await _build_record_out(record, db)


@router.post("/", response_model=ReimbursementRecordOut)
async def create_record(data: ReimbursementRecordCreate, db: AsyncSession = Depends(get_db)):
    """提交一条报销记录，关联 N 笔待报销支出"""
    if not data.transaction_ids:
        raise HTTPException(status_code=400, detail="请至少选择一笔待报销账单")

    # 校验账户
    if data.to_account_id:
        acc = await db.get(Account, data.to_account_id)
        if not acc:
            raise HTTPException(status_code=400, detail="到账账户不存在")

    # 拉取要关联的 transactions
    result = await db.execute(
        select(Transaction).where(Transaction.id.in_(data.transaction_ids))
    )
    txns = result.scalars().all()
    if len(txns) != len(set(data.transaction_ids)):
        raise HTTPException(status_code=400, detail="部分待报销账单不存在")

    for t in txns:
        if not t.is_reimbursable:
            raise HTTPException(status_code=400, detail=f"账单 {t.id} 未标记为可报销")
        if t.reimbursement_status == "done":
            raise HTTPException(status_code=400, detail=f"账单 {t.id} 已被其他报销记录覆盖")

    # 创建报销记录
    record = ReimbursementRecord(
        date=data.date,
        to_account_id=data.to_account_id,
        total_amount=data.total_amount,
        note=data.note,
        source="manual",
    )
    db.add(record)
    await db.flush()

    # 建立关联（MVP：默认每笔的 amount = 自己的 reimbursable_amount，如果 reimbursable_amount=0 则用 amount）
    for t in txns:
        link_amount = t.reimbursable_amount if t.reimbursable_amount > 0 else t.amount
        await db.execute(sa_insert(reimbursement_items).values(
            record_id=record.id,
            transaction_id=t.id,
            amount=link_amount,
        ))
        # 更新原交易状态
        await db.execute(
            sa_update(Transaction)
            .where(Transaction.id == t.id)
            .values(reimbursement_status="done")
        )

    await db.commit()
    await db.refresh(record)
    return await _build_record_out(record, db)


@router.delete("/{record_id}")
async def delete_record(record_id: int, db: AsyncSession = Depends(get_db)):
    """撤销报销：删除报销记录，被关联的 txn 回到 pending"""
    record = await db.get(ReimbursementRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="报销记录不存在")

    # 找出所有被关联的 transaction_id
    rows = await db.execute(
        select(reimbursement_items.c.transaction_id).where(
            reimbursement_items.c.record_id == record_id
        )
    )
    txn_ids = [r[0] for r in rows]

    # 删关联 + 回退状态
    await db.execute(sa_delete(reimbursement_items).where(reimbursement_items.c.record_id == record_id))
    if txn_ids:
        await db.execute(
            sa_update(Transaction)
            .where(Transaction.id.in_(txn_ids))
            .values(reimbursement_status="pending")
        )
    await db.delete(record)
    await db.commit()
    return {"ok": True, "reverted_transactions": len(txn_ids)}
