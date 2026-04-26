"""智能分类引擎 - 根据关键词匹配交易到分类"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import Category
from app.parsers.base import ParsedTransaction


async def categorize_transactions(
    transactions: list[ParsedTransaction],
    db: AsyncSession,
) -> list[ParsedTransaction]:
    """根据 Category.keywords 给每条交易自动分配 category_id"""
    result = await db.execute(select(Category))
    categories = result.scalars().all()

    # 按 type 把分类拆开
    by_type = {"expense": [], "income": []}
    for cat in categories:
        if cat.type in by_type:
            keywords = [k.strip() for k in (cat.keywords or "").split(",") if k.strip()]
            by_type[cat.type].append((cat, keywords))

    # 每个分类设默认 fallback：其他支出/其他收入
    fallback = {"expense": None, "income": None}
    for cat in categories:
        if cat.name in ("其他支出", "其他收入"):
            fallback[cat.type] = cat

    for txn in transactions:
        cat_list = by_type.get(txn.type, [])
        # 拼接所有可匹配的文本
        haystack = f"{txn.description} {txn.counterparty} {txn.note}".lower()

        matched = None
        for cat, keywords in cat_list:
            for kw in keywords:
                if kw and kw.lower() in haystack:
                    matched = cat
                    break
            if matched:
                break

        if not matched:
            matched = fallback.get(txn.type)

        if matched:
            txn.category_id = matched.id
            txn.category_name = matched.name

    return transactions
