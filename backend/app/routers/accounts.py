from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, insert as sa_insert, delete as sa_delete
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models import Account, Transaction, Holding, Tag, ReimbursementRecord, account_tags
from app.schemas import AccountCreate, AccountUpdate, AccountOut

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


async def _set_tags(account_id: int, tag_ids: list[int], db: AsyncSession):
    """设置账户标签（直接操作关联表，避免 lazy load MissingGreenlet 错误）"""
    await db.execute(sa_delete(account_tags).where(account_tags.c.account_id == account_id))
    for tid in tag_ids:
        await db.execute(sa_insert(account_tags).values(account_id=account_id, tag_id=tid))


async def _with_current_balance(accounts: list[Account], db: AsyncSession) -> list[dict]:
    """为每个账户计算动态余额：
    - 作为 account_id 的交易：expense 减，income 加，transfer 减（转出）
    - 作为 to_account_id 的交易：transfer 加（转入）
    """
    if not accounts:
        return []

    account_ids = [a.id for a in accounts]

    rows_out = await db.execute(
        select(Transaction.account_id, Transaction.type, func.sum(Transaction.amount))
        .where(Transaction.account_id.in_(account_ids))
        .group_by(Transaction.account_id, Transaction.type)
    )
    rows_in = await db.execute(
        select(Transaction.to_account_id, func.sum(Transaction.amount))
        .where(
            Transaction.to_account_id.in_(account_ids),
            Transaction.type == "transfer",
        )
        .group_by(Transaction.to_account_id)
    )

    delta: dict[int, float] = {a.id: 0.0 for a in accounts}
    for acc_id, txn_type, total in rows_out:
        if txn_type == "income":
            delta[acc_id] += total
        else:
            delta[acc_id] -= total
    for acc_id, total in rows_in:
        delta[acc_id] += total

    # 报销记录：to_account_id 加上 total_amount（报销款到账）
    reim_rows = await db.execute(
        select(ReimbursementRecord.to_account_id, func.sum(ReimbursementRecord.total_amount))
        .where(ReimbursementRecord.to_account_id.in_(account_ids))
        .group_by(ReimbursementRecord.to_account_id)
    )
    for acc_id, total in reim_rows:
        if acc_id is not None:
            delta[acc_id] += float(total or 0)

    # 投资理财账户：汇总绑定持仓的市值
    holding_value: dict[int, float] = {a.id: 0.0 for a in accounts}
    invest_ids = [a.id for a in accounts if a.category == "投资理财"]
    if invest_ids:
        h_rows = await db.execute(
            select(Holding.account_id, func.sum(Holding.current_value))
            .where(Holding.account_id.in_(invest_ids))
            .group_by(Holding.account_id)
        )
        for acc_id, total in h_rows:
            if acc_id is not None:
                holding_value[acc_id] = float(total or 0)

    result = []
    for a in accounts:
        # 投资理财账户：余额 = 持仓市值（不累加 transfer 流水/初始余额，
        # 因为转入的现金会立刻形成持仓成本，让 holding_value 接住即可，
        # 否则会在 "transfer 流水 + 持仓市值" 处双倍计算）
        if a.category == "投资理财":
            cb = round(holding_value[a.id], 2)
        else:
            cb = round(a.balance + delta[a.id] + holding_value[a.id], 2)
        d = {
            "id": a.id,
            "name": a.name,
            "icon": a.icon,
            "category": a.category,
            "balance": a.balance,
            "current_balance": cb,
            "member_id": a.member_id,
            "note": a.note,
            "sort_order": a.sort_order,
            "created_at": a.created_at,
            "member": a.member,
            "tags": a.tags,
        }
        result.append(d)
    return result


def _base_query():
    return (
        select(Account)
        .options(
            selectinload(Account.member),
            selectinload(Account.tags),
        )
        .order_by(Account.sort_order, Account.id)
    )


@router.get("/", response_model=list[AccountOut])
async def list_accounts(
    member_id: int = None,  # 0 = 仅未指定（NULL）
    db: AsyncSession = Depends(get_db),
):
    query = _base_query()
    if member_id is not None:
        query = query.where(
            Account.member_id.is_(None) if member_id == 0 else Account.member_id == member_id
        )
    result = await db.execute(query)
    accounts = result.scalars().all()
    return await _with_current_balance(list(accounts), db)


@router.post("/", response_model=AccountOut)
async def create_account(data: AccountCreate, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump(exclude={"tag_ids"})
    account = Account(**payload)
    db.add(account)
    await db.flush()
    await _set_tags(account.id, data.tag_ids, db)
    await db.commit()
    result = await db.execute(_base_query().where(Account.id == account.id))
    accounts = result.scalars().all()
    return (await _with_current_balance(list(accounts), db))[0]


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(account_id: int, data: AccountUpdate, db: AsyncSession = Depends(get_db)):
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="账户不存在")
    for k, v in data.model_dump(exclude={"tag_ids"}).items():
        setattr(account, k, v)
    await _set_tags(account_id, data.tag_ids, db)
    await db.commit()
    result = await db.execute(_base_query().where(Account.id == account_id))
    accounts = result.scalars().all()
    return (await _with_current_balance(list(accounts), db))[0]


@router.delete("/{account_id}")
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)):
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="账户不存在")
    await db.delete(account)
    await db.commit()
    return {"ok": True}
