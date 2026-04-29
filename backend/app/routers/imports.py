"""账单导入接口

流程：
1. POST /api/imports/parse  上传文件 → 返回解析后的交易（未入库）+ 报销记录（未入库）
2. POST /api/imports/save   提交确认后的交易列表 + 报销记录列表 → 批量入库 + 建立关联
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert, update as sa_update
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models import (
    Transaction, Tag, TagCategory, transaction_tags,
    ReimbursementRecord, reimbursement_items, Account,
)
from app.parsers import get_parser, ParsedReimbursement
from app.parsers.categorizer import categorize_transactions

router = APIRouter(prefix="/api/imports", tags=["imports"])

# 导入时自动创建的标签归属分类名
IMPORT_TAG_CATEGORY_NAME = "导入标签"


class ParsedTxnOut(BaseModel):
    """解析后返回给前端的交易（包含临时索引）"""
    index: int
    amount: float
    type: str
    date: date
    description: str
    counterparty: str
    note: str
    category_id: Optional[int]
    category_name: Optional[str]
    payment_method: str
    raw: str
    is_duplicate: bool = False
    tag_ids: list[int] = []        # 已解析/预填充的标签 ID（钱迹自动填）
    tag_names: list[str] = []      # 对应标签名（仅用于显示）
    # 报销字段（钱迹导入时填充）
    is_reimbursable: bool = False
    reimbursable_amount: float = 0
    reimbursement_status: str = "none"
    external_id: str = ""
    default_unchecked: bool = False  # 解析时建议默认不勾选


class ParsedReimOut(BaseModel):
    """解析后返回给前端的报销记录"""
    index: int
    amount: float
    date: date
    payment_method: str
    note: str
    external_id: str
    linked_external_id: str
    raw: str
    is_duplicate: bool = False  # 已存在 external_id 的报销记录


class ImportTxnIn(BaseModel):
    """前端确认后回传的单条交易"""
    amount: float
    type: str
    date: date
    description: str = ""
    counterparty: str = ""
    note: str = ""
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    member_id: Optional[int] = None
    tag_ids: list[int] = []
    tag_names: list[str] = []
    # 报销
    is_reimbursable: bool = False
    reimbursable_amount: float = 0
    reimbursement_status: str = "none"
    external_id: str = ""


class ImportReimIn(BaseModel):
    """前端确认后回传的单条报销记录"""
    amount: float
    date: date
    note: str = ""
    to_account_id: Optional[int] = None
    external_id: str = ""
    linked_external_id: str = ""


class ImportRequest(BaseModel):
    source: str
    transactions: list[ImportTxnIn]
    reimbursements: list[ImportReimIn] = []


async def _resolve_tag_names(tag_names: list[str], db: AsyncSession) -> list[int]:
    """将标签字符串列表解析为 Tag ID 列表（仅在 save 时调用）。"""
    if not tag_names:
        return []

    result = await db.execute(
        select(TagCategory).where(TagCategory.name == IMPORT_TAG_CATEGORY_NAME)
    )
    import_cat = result.scalar_one_or_none()
    if not import_cat:
        import_cat = TagCategory(name=IMPORT_TAG_CATEGORY_NAME, icon="📥", sort_order=99)
        db.add(import_cat)
        await db.flush()

    tag_ids = []
    for name in tag_names:
        result = await db.execute(select(Tag).where(Tag.name == name))
        tag = result.scalar_one_or_none()
        if not tag:
            tag = Tag(name=name, icon="🏷️", category_id=import_cat.id)
            db.add(tag)
            await db.flush()
        tag_ids.append(tag.id)

    return tag_ids


def _match_account_by_name(payment_method: str, accounts: list[Account]) -> Optional[int]:
    """按账户名模糊匹配（供报销记录/报销支出自动选账户用）"""
    if not payment_method:
        return None
    pm_lower = payment_method.lower()
    # 先严格包含
    for a in accounts:
        if a.name and a.name in payment_method:
            return a.id
    # 再反向包含（账户名被 payment_method 包含）
    for a in accounts:
        if a.name and payment_method in a.name:
            return a.id
    # 关键词匹配
    for a in accounts:
        if a.name and a.name.lower() in pm_lower:
            return a.id
    return None


@router.post("/parse")
async def parse_bill(
    source: str = Form(...),
    file: UploadFile = File(...),
    start_date: Optional[date] = Form(None),
    end_date: Optional[date] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """解析上传的账单文件，返回交易列表 + 报销记录列表（均未入库）

    可选 start_date / end_date：按账单日期过滤（含端点）。主要用于钱迹这类
    一次性导出所有历史的来源，避免重复处理已入库的旧账单。
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期")

    try:
        parser = get_parser(source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    items = parser.parse(file_bytes, file.filename or "")
    if not items:
        return {
            "count": 0,
            "reim_count": 0,
            "transactions": [],
            "reimbursements": [],
            "message": "未能从文件中解析出交易记录",
        }

    # 拆分：Transaction 和 ReimbursementRecord
    transactions = [t for t in items if not isinstance(t, ParsedReimbursement)]
    reimbursements = [r for r in items if isinstance(r, ParsedReimbursement)]

    # 按日期范围过滤（如指定）
    raw_total = len(transactions) + len(reimbursements)
    if start_date or end_date:
        def _in_range(d: date) -> bool:
            if start_date and d < start_date:
                return False
            if end_date and d > end_date:
                return False
            return True
        transactions = [t for t in transactions if _in_range(t.date)]
        reimbursements = [r for r in reimbursements if _in_range(r.date)]
    filtered_out = raw_total - (len(transactions) + len(reimbursements))

    # 智能分类（仅对 Transaction）
    transactions = await categorize_transactions(transactions, db)

    # 账户列表（用于报销记录匹配到账账户）
    accounts = (await db.execute(select(Account))).scalars().all()

    # 交易去重检测
    duplicate_indices: set[int] = set()
    if transactions:
        min_date = min(t.date for t in transactions)
        max_date = max(t.date for t in transactions)
        result = await db.execute(
            select(Transaction).where(
                Transaction.date >= min_date - timedelta(days=1),
                Transaction.date <= max_date + timedelta(days=1),
            )
        )
        existing = result.scalars().all()

        for i, t in enumerate(transactions):
            # external_id 匹配优先（钱迹跨次导入直接认为重复）
            if t.external_id:
                for ex in existing:
                    if ex.external_id and ex.external_id == t.external_id:
                        duplicate_indices.add(i)
                        break
                if i in duplicate_indices:
                    continue
            for ex in existing:
                if (
                    abs(t.amount - ex.amount) < 0.001
                    and t.type == ex.type
                    and abs((t.date - ex.date).days) <= 1
                ):
                    duplicate_indices.add(i)
                    break

    # 报销记录去重（按 external_id）
    reim_dup: set[int] = set()
    if reimbursements:
        existing_reim = (await db.execute(
            select(ReimbursementRecord.external_id).where(
                ReimbursementRecord.external_id != "",
            )
        )).scalars().all()
        existing_reim_set = set(existing_reim)
        for i, r in enumerate(reimbursements):
            if r.external_id and r.external_id in existing_reim_set:
                reim_dup.add(i)

    # 构造返回交易列表
    parsed_out = []
    for i, t in enumerate(transactions):
        tag_names: list[str] = t.tags or []
        parsed_out.append(ParsedTxnOut(
            index=i,
            amount=t.amount,
            type=t.type,
            date=t.date,
            description=t.description,
            counterparty=t.counterparty,
            note=t.note,
            category_id=t.category_id,
            category_name=t.category_name,
            payment_method=t.payment_method,
            raw=t.raw,
            is_duplicate=(i in duplicate_indices),
            tag_ids=[],
            tag_names=tag_names,
            is_reimbursable=t.is_reimbursable,
            reimbursable_amount=t.reimbursable_amount,
            reimbursement_status=t.reimbursement_status,
            external_id=t.external_id,
            default_unchecked=t.default_unchecked,
        ))

    # 构造返回报销记录列表（自动匹配到账账户）
    reim_out = []
    for i, r in enumerate(reimbursements):
        matched_acc = _match_account_by_name(r.payment_method, list(accounts))
        reim_out.append({
            **ParsedReimOut(
                index=i,
                amount=r.amount,
                date=r.date,
                payment_method=r.payment_method,
                note=r.note,
                external_id=r.external_id,
                linked_external_id=r.linked_external_id,
                raw=r.raw,
                is_duplicate=(i in reim_dup),
            ).model_dump(),
            "to_account_id": matched_acc,
        })

    msg = ""
    if filtered_out > 0 and not parsed_out and not reim_out:
        msg = f"日期范围内未匹配到任何记录（共过滤掉 {filtered_out} 条）"

    return {
        "count": len(parsed_out),
        "dup_count": len(duplicate_indices),
        "reim_count": len(reim_out),
        "reim_dup_count": len(reim_dup),
        "filtered_out": filtered_out,
        "transactions": parsed_out,
        "reimbursements": reim_out,
        "message": msg,
    }


@router.post("/save")
async def save_imported(req: ImportRequest, db: AsyncSession = Depends(get_db)):
    """批量保存确认后的交易 + 报销记录 + 建立关联"""
    saved = 0
    # external_id → transaction.id 映射（用于关联报销记录）
    ext_to_txn_id: dict[str, int] = {}

    for t in req.transactions:
        # 如果标记可报销但没填 reimbursable_amount，兜底=amount
        reimbursable_amount = t.reimbursable_amount
        reimbursement_status = t.reimbursement_status or "none"
        if t.is_reimbursable:
            if not reimbursable_amount:
                reimbursable_amount = t.amount
            if reimbursement_status == "none":
                reimbursement_status = "pending"

        txn = Transaction(
            amount=t.amount,
            type=t.type,
            description=t.description,
            counterparty=t.counterparty,
            date=t.date,
            source=req.source,
            category_id=t.category_id,
            account_id=t.account_id,
            to_account_id=t.to_account_id,
            member_id=t.member_id,
            note=t.note,
            is_reimbursable=t.is_reimbursable,
            reimbursable_amount=reimbursable_amount,
            reimbursement_status=reimbursement_status,
            external_id=t.external_id or "",
        )
        db.add(txn)
        await db.flush()

        if t.external_id:
            ext_to_txn_id[t.external_id] = txn.id

        # 处理标签
        all_tag_ids: list[int] = list(t.tag_ids)
        if t.tag_names:
            resolved = await _resolve_tag_names(t.tag_names, db)
            all_tag_ids = list(set(all_tag_ids + resolved))
        for tag_id in all_tag_ids:
            await db.execute(sa_insert(transaction_tags).values(transaction_id=txn.id, tag_id=tag_id))

        saved += 1

    reim_saved = 0
    reim_linked = 0
    for r in req.reimbursements:
        # 去重：如果 external_id 已存在，跳过
        if r.external_id:
            existing = (await db.execute(
                select(ReimbursementRecord).where(ReimbursementRecord.external_id == r.external_id)
            )).scalar_one_or_none()
            if existing:
                continue

        record = ReimbursementRecord(
            date=r.date,
            to_account_id=r.to_account_id,
            total_amount=r.amount,
            note=r.note,
            source=req.source,
            external_id=r.external_id or "",
        )
        db.add(record)
        await db.flush()
        reim_saved += 1

        # 建立关联：先查本次刚保存的，再查库里已有的
        if r.linked_external_id:
            linked_txn_id = ext_to_txn_id.get(r.linked_external_id)
            if not linked_txn_id:
                existing_txn = (await db.execute(
                    select(Transaction).where(Transaction.external_id == r.linked_external_id)
                )).scalar_one_or_none()
                if existing_txn:
                    linked_txn_id = existing_txn.id

            if linked_txn_id:
                # 用关联账单的 reimbursable_amount 或 amount 作为 link amount
                target = await db.get(Transaction, linked_txn_id)
                link_amount = r.amount
                if target:
                    link_amount = target.reimbursable_amount if target.reimbursable_amount > 0 else target.amount
                await db.execute(sa_insert(reimbursement_items).values(
                    record_id=record.id,
                    transaction_id=linked_txn_id,
                    amount=link_amount,
                ))
                # 原交易状态置为 done
                await db.execute(
                    sa_update(Transaction)
                    .where(Transaction.id == linked_txn_id)
                    .values(reimbursement_status="done")
                )
                reim_linked += 1

    await db.commit()
    return {
        "saved": saved,
        "reim_saved": reim_saved,
        "reim_linked": reim_linked,
    }
