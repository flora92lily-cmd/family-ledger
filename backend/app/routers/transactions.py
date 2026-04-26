from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract, insert as sa_insert, delete as sa_delete, case
from sqlalchemy.orm import selectinload
from datetime import date
from app.database import get_db
from app.models import Transaction, Category, Account, Tag, FamilyMember, transaction_tags
from app.schemas import (
    TransactionCreate, TransactionUpdate, TransactionOut,
    MonthlySummary, CategorySummary, MemberSummary,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


async def _set_tags(txn_id: int, tag_ids: list[int], db: AsyncSession):
    """设置交易标签（直接操作关联表，避免 lazy load MissingGreenlet 错误）"""
    await db.execute(sa_delete(transaction_tags).where(transaction_tags.c.transaction_id == txn_id))
    for tid in tag_ids:
        await db.execute(sa_insert(transaction_tags).values(transaction_id=txn_id, tag_id=tid))


@router.get("/", response_model=list[TransactionOut])
async def list_transactions(
    year: int = None,
    month: int = None,
    tag_id: int = None,
    category_id: int = None,
    type: str = None,
    member_id: int = None,  # 0 = 仅未指定（NULL），>0 = 指定成员
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.account),
            selectinload(Transaction.to_account),
            selectinload(Transaction.member),
            selectinload(Transaction.tags),
        )
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    )
    if year:
        query = query.where(extract("year", Transaction.date) == year)
    if month:
        query = query.where(extract("month", Transaction.date) == month)
    if tag_id:
        query = query.where(
            Transaction.id.in_(
                select(transaction_tags.c.transaction_id).where(
                    transaction_tags.c.tag_id == tag_id
                )
            )
        )
    if category_id:
        query = query.where(Transaction.category_id == category_id)
    if type:
        query = query.where(Transaction.type == type)
    if member_id is not None:
        if member_id == 0:
            query = query.where(Transaction.member_id.is_(None))
        else:
            query = query.where(Transaction.member_id == member_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=TransactionOut)
async def create_transaction(data: TransactionCreate, db: AsyncSession = Depends(get_db)):
    payload = data.model_dump(exclude={"tag_ids"})
    # 如果标记为可报销且未指定 reimbursable_amount，默认等于 amount；状态默认 pending
    if payload.get("is_reimbursable"):
        if not payload.get("reimbursable_amount"):
            payload["reimbursable_amount"] = payload["amount"]
        if payload.get("reimbursement_status", "none") == "none":
            payload["reimbursement_status"] = "pending"
    txn = Transaction(**payload)
    db.add(txn)
    await db.flush()
    await _set_tags(txn.id, data.tag_ids, db)
    await db.commit()
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.account),
            selectinload(Transaction.to_account),
            selectinload(Transaction.member),
            selectinload(Transaction.tags),
        )
        .where(Transaction.id == txn.id)
    )
    return result.scalar_one()


@router.patch("/{txn_id}", response_model=TransactionOut)
async def update_transaction(txn_id: int, data: TransactionUpdate, db: AsyncSession = Depends(get_db)):
    """局部更新交易（含报销字段）。主要用于后期给历史交易打上"可报销"标记。"""
    txn = await db.get(Transaction, txn_id)
    if not txn:
        raise HTTPException(status_code=404, detail="交易不存在")

    patch = data.model_dump(exclude_unset=True)
    tag_ids = patch.pop("tag_ids", None)

    # 处理报销标记切换
    if "is_reimbursable" in patch:
        if patch["is_reimbursable"]:
            # 打开可报销标记
            if txn.reimbursement_status in ("none", ""):
                patch.setdefault("reimbursement_status", "pending")
            if not patch.get("reimbursable_amount") and not txn.reimbursable_amount:
                patch.setdefault("reimbursable_amount", txn.amount)
        else:
            # 关闭可报销标记：已关联报销记录的不允许关闭
            if txn.reimbursement_status == "done":
                raise HTTPException(status_code=400, detail="该账单已被报销记录关联，请先撤销对应报销记录")
            patch["reimbursement_status"] = "none"
            patch["reimbursable_amount"] = 0

    for k, v in patch.items():
        setattr(txn, k, v)

    if tag_ids is not None:
        await _set_tags(txn_id, tag_ids, db)

    await db.commit()
    result = await db.execute(
        select(Transaction)
        .options(
            selectinload(Transaction.category),
            selectinload(Transaction.account),
            selectinload(Transaction.to_account),
            selectinload(Transaction.member),
            selectinload(Transaction.tags),
        )
        .where(Transaction.id == txn_id)
    )
    return result.scalar_one()


@router.delete("/{txn_id}")
async def delete_transaction(txn_id: int, db: AsyncSession = Depends(get_db)):
    txn = await db.get(Transaction, txn_id)
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # 如果该交易已被某报销记录关联，阻止删除（需先撤销报销）
    if txn.reimbursement_status == "done":
        raise HTTPException(status_code=400, detail="该账单已被报销记录关联，请先撤销对应报销记录再删除")
    await db.delete(txn)
    await db.commit()
    return {"ok": True}


def _effective_expense_amount():
    """SQL 表达式：可报销支出按 max(0, amount - reimbursable_amount) 计入，非可报销按 amount 计入。"""
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


@router.get("/summary/monthly", response_model=list[MonthlySummary])
async def monthly_summary(
    year: int = Query(...),
    tag_id: int = None,
    member_id: int = None,  # 0 = 仅未指定（NULL）
    db: AsyncSession = Depends(get_db),
):
    """按月汇总收支（可报销支出按差额计入，全额报销=0）"""
    # 支出（特殊处理：可报销按差额）
    expense_q = select(
        func.printf("%d-%02d", extract("year", Transaction.date), extract("month", Transaction.date)).label("month"),
        func.sum(_effective_expense_amount()).label("total"),
    ).where(
        extract("year", Transaction.date) == year,
        Transaction.type == "expense",
    )

    # 收入（正常汇总）
    income_q = select(
        func.printf("%d-%02d", extract("year", Transaction.date), extract("month", Transaction.date)).label("month"),
        func.sum(Transaction.amount).label("total"),
    ).where(
        extract("year", Transaction.date) == year,
        Transaction.type == "income",
    )

    if tag_id:
        tag_filter = Transaction.id.in_(
            select(transaction_tags.c.transaction_id).where(
                transaction_tags.c.tag_id == tag_id
            )
        )
        expense_q = expense_q.where(tag_filter)
        income_q = income_q.where(tag_filter)

    if member_id is not None:
        member_filter = Transaction.member_id.is_(None) if member_id == 0 else Transaction.member_id == member_id
        expense_q = expense_q.where(member_filter)
        income_q = income_q.where(member_filter)

    expense_q = expense_q.group_by("month")
    income_q = income_q.group_by("month")

    exp_rows = (await db.execute(expense_q)).all()
    inc_rows = (await db.execute(income_q)).all()

    monthly: dict[str, dict] = {}
    for m, total in exp_rows:
        monthly.setdefault(m, {"month": m, "total_income": 0, "total_expense": 0, "balance": 0})
        monthly[m]["total_expense"] = round(float(total or 0), 2)
    for m, total in inc_rows:
        monthly.setdefault(m, {"month": m, "total_income": 0, "total_expense": 0, "balance": 0})
        monthly[m]["total_income"] = round(float(total or 0), 2)

    for m in monthly.values():
        m["balance"] = round(m["total_income"] - m["total_expense"], 2)

    return sorted(monthly.values(), key=lambda x: x["month"])


@router.get("/summary/category", response_model=list[CategorySummary])
async def category_summary(
    year: int = Query(...),
    month: int = Query(...),
    type: str = "expense",
    tag_id: int = None,
    member_id: int = None,  # 0 = 仅未指定（NULL）
    db: AsyncSession = Depends(get_db),
):
    """按分类汇总（支出时：可报销部分按差额计入）"""
    # 支出走 effective_expense（可报销按差额），其他类型走原 amount
    amount_expr = _effective_expense_amount() if type == "expense" else Transaction.amount

    query = (
        select(
            Category.name,
            Category.icon,
            func.sum(amount_expr).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
        )
    )
    if tag_id:
        query = query.where(
            Transaction.id.in_(
                select(transaction_tags.c.transaction_id).where(
                    transaction_tags.c.tag_id == tag_id
                )
            )
        )
    if member_id is not None:
        query = query.where(
            Transaction.member_id.is_(None) if member_id == 0 else Transaction.member_id == member_id
        )

    query = query.group_by(Category.name, Category.icon)
    result = await db.execute(query)
    rows = result.all()

    # 过滤掉 total=0 的分类（全额报销的类别可能汇总后为 0）
    rows = [r for r in rows if r.total and float(r.total) > 0]

    grand_total = sum(float(r.total) for r in rows) or 1
    return [
        CategorySummary(
            category_name=r.name,
            category_icon=r.icon,
            total=round(float(r.total), 2),
            percentage=round(float(r.total) / grand_total * 100, 1),
        )
        for r in sorted(rows, key=lambda x: float(x.total), reverse=True)
    ]


@router.get("/summary/member", response_model=list[MemberSummary])
async def member_summary(
    year: int = Query(...),
    month: int = Query(...),
    type: str = "expense",
    db: AsyncSession = Depends(get_db),
):
    """按家庭成员汇总（支出时按差额计入；NULL 归类为'未指定'）"""
    amount_expr = _effective_expense_amount() if type == "expense" else Transaction.amount

    query = (
        select(
            Transaction.member_id,
            FamilyMember.name,
            FamilyMember.avatar,
            func.sum(amount_expr).label("total"),
        )
        .outerjoin(FamilyMember, Transaction.member_id == FamilyMember.id)
        .where(
            extract("year", Transaction.date) == year,
            extract("month", Transaction.date) == month,
            Transaction.type == type,
        )
        .group_by(Transaction.member_id, FamilyMember.name, FamilyMember.avatar)
    )

    rows = (await db.execute(query)).all()
    rows = [r for r in rows if r.total and float(r.total) > 0]

    grand_total = sum(float(r.total) for r in rows) or 1
    return [
        MemberSummary(
            member_id=r.member_id,
            member_name=r.name or "未指定",
            member_avatar=r.avatar or "❓",
            total=round(float(r.total), 2),
            percentage=round(float(r.total) / grand_total * 100, 1),
        )
        for r in sorted(rows, key=lambda x: float(x.total), reverse=True)
    ]
