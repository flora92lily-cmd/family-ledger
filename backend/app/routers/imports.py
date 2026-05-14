"""账单导入接口

流程：
1. POST /api/imports/parse  上传文件 → 返回解析后的交易（未入库）+ 报销记录（未入库）
2. POST /api/imports/save   提交确认后的交易列表 + 报销记录列表 → 批量入库 + 建立关联
"""
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert as sa_insert, update as sa_update, delete as sa_delete
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models import (
    Transaction, Tag, TagCategory, transaction_tags,
    ReimbursementRecord, reimbursement_items, Account, Holding,
    PaymentMethodMapping, MerchantCategory,
)
from app.parsers import get_parser, ParsedReimbursement
from app.parsers.categorizer import categorize_transactions
from app.price_service import search_fund_by_name, fetch_fund_nav_on

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
    category_id: Optional[int]
    category_name: Optional[str]
    account_id: Optional[int] = None  # 由历史 payment_method 映射预填（仅非 transfer）
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
    # 投资交易识别（detector 已识别 + 后端预匹配/反查）
    detected_action: str = ""           # buy / sell / ""
    detected_asset_type: str = ""       # fund / stock / ""
    detected_name: str = ""             # 提取的基金名
    detected_code: str = ""
    target_holding_id: Optional[int] = None
    target_holding_name: Optional[str] = None
    fund_search_candidates: list[dict] = []  # [{code, name}]，本地匹配不到时给前端选


class AccountMappingItem(BaseModel):
    """payment_method ↔ account_id 的映射条目（双向用于 parse 返回 / save 提交）"""
    raw_name: str
    account_id: Optional[int] = None


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
    # 投资交易（save 时用于自动算份额 / 当场建仓）
    detected_action: str = ""           # buy / sell / ""
    detected_asset_type: str = ""       # fund / stock / ""
    target_holding_id: Optional[int] = None
    new_holding_code: Optional[str] = None
    new_holding_name: Optional[str] = None
    new_holding_account_id: Optional[int] = None


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
    account_mappings: list[AccountMappingItem] = []  # 本次导入的 (payment_method → account_id) 映射，save 时 upsert


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

    # 投资交易后处理：本地 holdings 名称匹配 → 反查 eastmoney 候选
    invest_txns = [t for t in transactions if t.detected_action]
    fund_search_results: dict[str, list[dict]] = {}
    holding_id_to_name: dict[int, str] = {}
    if invest_txns:
        local_holdings = (await db.execute(
            select(Holding).where(Holding.asset_type.in_(["fund", "stock"]))
        )).scalars().all()
        holding_id_to_name = {h.id: h.name for h in local_holdings}
        # 双向 substring 匹配
        for t in invest_txns:
            if not t.detected_name:
                continue
            for h in local_holdings:
                if h.name and (h.name in t.detected_name or t.detected_name in h.name):
                    t.target_holding_id = h.id
                    break
        # 收集本地未命中的 fund 名称，去 eastmoney 反查
        unmatched = sorted({
            t.detected_name for t in invest_txns
            if t.detected_asset_type == "fund"
            and t.target_holding_id is None
            and t.detected_name
        })
        for name in unmatched:
            fund_search_results[name] = await search_fund_by_name(name)

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

    # 历史账户映射查询：聚合需要按 payment_method 决定 from 账户的交易的 distinct payment_method
    # （非 transfer 交易 + 投资买入/赎回 transfer——后者 from 端是资金账户，按 payment_method 映射）
    distinct_pm = sorted({
        (t.payment_method or "")
        for t in transactions
        if t.type != "transfer" or t.detected_action
    })
    pm_to_account: dict[str, Optional[int]] = {}
    if distinct_pm:
        rows = (await db.execute(
            select(PaymentMethodMapping.raw_name, PaymentMethodMapping.account_id).where(
                PaymentMethodMapping.source == source,
                PaymentMethodMapping.raw_name.in_(distinct_pm),
            )
        )).all()
        # 校验 account_id 仍然指向存在的账户（被删除则置空）
        existing_account_ids = {a.id for a in accounts}
        for raw_name, acc_id in rows:
            if acc_id and acc_id not in existing_account_ids:
                acc_id = None
            pm_to_account[raw_name] = acc_id

    # 构造返回交易列表（用映射预填 account_id，对非转账 + 投资 transfer 都填）
    parsed_out = []
    for i, t in enumerate(transactions):
        tag_names: list[str] = t.tags or []
        prefilled_account_id: Optional[int] = None
        if t.type != "transfer" or t.detected_action:
            prefilled_account_id = pm_to_account.get(t.payment_method or "")
        parsed_out.append(ParsedTxnOut(
            index=i,
            amount=t.amount,
            type=t.type,
            date=t.date,
            description=t.description,
            counterparty=t.counterparty,
            category_id=t.category_id,
            category_name=t.category_name,
            account_id=prefilled_account_id,
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
            detected_action=t.detected_action,
            detected_asset_type=t.detected_asset_type,
            detected_name=t.detected_name,
            detected_code=t.detected_code,
            target_holding_id=t.target_holding_id,
            target_holding_name=holding_id_to_name.get(t.target_holding_id) if t.target_holding_id else None,
            fund_search_candidates=fund_search_results.get(t.detected_name, []) if t.detected_name and t.target_holding_id is None else [],
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

    # 构造 account_mappings 返回：每个 distinct payment_method 一条（含空字符串），
    # account_id 为历史映射结果（无映射或被删账户则 None，前端会再做启发式兜底）
    account_mappings_out = [
        AccountMappingItem(raw_name=pm, account_id=pm_to_account.get(pm))
        for pm in distinct_pm
    ]

    return {
        "count": len(parsed_out),
        "dup_count": len(duplicate_indices),
        "reim_count": len(reim_out),
        "reim_dup_count": len(reim_dup),
        "filtered_out": filtered_out,
        "transactions": parsed_out,
        "reimbursements": reim_out,
        "account_mappings": account_mappings_out,
        "message": msg,
    }


@router.post("/save")
async def save_imported(req: ImportRequest, db: AsyncSession = Depends(get_db)):
    """批量保存确认后的交易 + 报销记录 + 建立关联"""
    saved = 0
    # external_id → transaction.id 映射（用于关联报销记录）
    ext_to_txn_id: dict[str, int] = {}

    holdings_updated = 0
    holdings_created = 0
    holdings_warnings: list[str] = []

    for t in req.transactions:
        # 如果标记可报销但没填 reimbursable_amount，兜底=amount
        reimbursable_amount = t.reimbursable_amount
        reimbursement_status = t.reimbursement_status or "none"
        if t.is_reimbursable:
            if not reimbursable_amount:
                reimbursable_amount = t.amount
            if reimbursement_status == "none":
                reimbursement_status = "pending"

        # 当场建仓：投资交易但前端提供了 new_holding_code（用户选了 eastmoney 候选）
        target_holding_id = t.target_holding_id
        if t.detected_action and target_holding_id is None and t.new_holding_code:
            new_h = Holding(
                name=(t.new_holding_name or t.new_holding_code),
                code=t.new_holding_code,
                asset_type=(t.detected_asset_type or "fund"),
                shares=0,
                cost_price=0,
                current_price=0,
                current_value=0,
                account_id=t.new_holding_account_id,
            )
            db.add(new_h)
            await db.flush()
            target_holding_id = new_h.id
            holdings_created += 1

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

        # 投资交易：自动按账单日历史净值算份额，更新 holding
        if t.detected_action and target_holding_id and t.detected_asset_type == "fund":
            h = await db.get(Holding, target_holding_id)
            if h and h.code:
                nav = await fetch_fund_nav_on(h.code, t.date)
                if not nav and h.current_price > 0:
                    nav = h.current_price  # fallback：用当前净值（粗估）
                if nav and nav > 0:
                    delta_shares = round(t.amount / nav, 6)
                    if t.detected_action == "buy":
                        old_shares = h.shares or 0
                        new_shares = old_shares + delta_shares
                        if new_shares > 0:
                            h.cost_price = round(
                                (h.cost_price * old_shares + t.amount) / new_shares, 6
                            )
                        h.shares = round(new_shares, 6)
                    elif t.detected_action == "sell":
                        h.shares = round(max(0.0, (h.shares or 0) - delta_shares), 6)
                    h.current_price = nav
                    h.current_value = round(h.shares * nav, 2)
                    holdings_updated += 1
                else:
                    holdings_warnings.append(f"{h.name}：未能查到 {t.date} 净值，份额未更新")
            elif h and not h.code:
                holdings_warnings.append(f"{h.name}：缺少基金代码，份额未更新")
        elif t.detected_action == "buy" and t.detected_asset_type == "stock":
            holdings_warnings.append("股票买入暂不自动算份额，请到持仓页手动调整")

        saved += 1

    # upsert 商户记忆（counterparty → category_id），供下次导入自动分类使用
    merchant_memory: dict[str, int] = {}
    for t in req.transactions:
        if t.counterparty and t.category_id and t.type in ("expense", "income"):
            merchant_memory[t.counterparty] = t.category_id
    for merchant, cat_id in merchant_memory.items():
        await db.execute(
            sa_delete(MerchantCategory).where(MerchantCategory.merchant == merchant)
        )
        await db.execute(
            sa_insert(MerchantCategory).values(merchant=merchant, category_id=cat_id)
        )

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

    # upsert 账户映射：account_id 为 None 的条目跳过（用户没决定，不存）
    mappings_saved = 0
    for m in req.account_mappings:
        if m.account_id is None:
            continue
        # 删旧再插入（SQLite 跨方言通用，比 ON CONFLICT 显式）
        await db.execute(
            sa_delete(PaymentMethodMapping).where(
                PaymentMethodMapping.source == req.source,
                PaymentMethodMapping.raw_name == m.raw_name,
            )
        )
        await db.execute(
            sa_insert(PaymentMethodMapping).values(
                source=req.source,
                raw_name=m.raw_name,
                account_id=m.account_id,
                last_used_at=datetime.now(),
            )
        )
        mappings_saved += 1

    await db.commit()
    return {
        "saved": saved,
        "reim_saved": reim_saved,
        "reim_linked": reim_linked,
        "mappings_saved": mappings_saved,
        "holdings_created": holdings_created,
        "holdings_updated": holdings_updated,
        "holdings_warnings": holdings_warnings,
    }
