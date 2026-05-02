"""智能分类引擎 - 给导入的交易自动分配 category_id

匹配优先级：
1. 来源账单自带的分类名（source_category_name → source_parent_category_name）
   按名直接查 Category 表（type 必须匹配），命中即用。钱迹导入走这条路径。
2. 关键词匹配 Category.keywords（在 description + counterparty 中找）
3. 兜底：其他支出 / 其他收入
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import Category
from app.parsers.base import ParsedTransaction


async def categorize_transactions(
    transactions: list[ParsedTransaction],
    db: AsyncSession,
) -> list[ParsedTransaction]:
    """根据来源分类名 + Category.keywords 给每条交易自动分配 category_id"""
    result = await db.execute(select(Category))
    categories = result.scalars().all()

    # 1. 名字 → 分类 索引（按 type 拆分，避免支出/收入同名分类窜）
    name_lookup: dict[str, dict[str, Category]] = {"expense": {}, "income": {}}
    for cat in categories:
        if cat.type in name_lookup:
            name_lookup[cat.type][cat.name] = cat

    # 2. 关键词匹配候选（只收录有关键词的分类，提速）
    by_type: dict[str, list[tuple[Category, list[str]]]] = {"expense": [], "income": []}
    for cat in categories:
        if cat.type not in by_type:
            continue
        keywords = [k.strip() for k in (cat.keywords or "").split(",") if k.strip()]
        if keywords:
            by_type[cat.type].append((cat, keywords))

    # 3. 兜底分类
    fallback: dict[str, Category | None] = {"expense": None, "income": None}
    for cat in categories:
        if cat.name == "其他支出" and cat.type == "expense":
            fallback["expense"] = cat
        elif cat.name == "其他收入" and cat.type == "income":
            fallback["income"] = cat

    for txn in transactions:
        # 0. 解析阶段已设过 category_id（少见情况）→ 尊重原值
        if txn.category_id:
            continue

        type_index = name_lookup.get(txn.type, {})
        matched: Category | None = None

        # 1. 来源分类名直接匹配
        if txn.source_category_name:
            matched = type_index.get(txn.source_category_name)
        if not matched and txn.source_parent_category_name:
            matched = type_index.get(txn.source_parent_category_name)

        # 2. 关键词匹配
        if not matched:
            haystack = f"{txn.description} {txn.counterparty}".lower()
            for cat, keywords in by_type.get(txn.type, []):
                for kw in keywords:
                    if kw and kw.lower() in haystack:
                        matched = cat
                        break
                if matched:
                    break

        # 3. 兜底
        if not matched:
            matched = fallback.get(txn.type)

        if matched:
            txn.category_id = matched.id
            txn.category_name = matched.name

    return transactions
