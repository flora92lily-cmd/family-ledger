from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./family_ledger.db")

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        # 1. 创建所有新表（已存在的表不会重建）
        await conn.run_sync(Base.metadata.create_all)

        # 2. 新增表兜底（create_all 在旧 DB 上有时不触发，用 IF NOT EXISTS 保证）
        for stmt in [
            """CREATE TABLE IF NOT EXISTS reimbursement_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                to_account_id INTEGER REFERENCES accounts(id),
                total_amount REAL NOT NULL,
                note VARCHAR(500) DEFAULT '',
                source VARCHAR(20) DEFAULT 'manual',
                external_id VARCHAR(100) DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS reimbursement_items (
                record_id INTEGER NOT NULL REFERENCES reimbursement_records(id) ON DELETE CASCADE,
                transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                amount REAL DEFAULT 0,
                PRIMARY KEY (record_id, transaction_id)
            )""",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass

        # 3. 旧列迁移（SQLite 不支持 IF NOT EXISTS，用 try/except）
        for stmt in [
            "ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)",
            "ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)",
            "ALTER TABLE transactions ADD COLUMN to_account_id INTEGER REFERENCES accounts(id)",
            "ALTER TABLE transactions ADD COLUMN is_reimbursable BOOLEAN DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN reimbursable_amount REAL DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN reimbursement_status VARCHAR(10) DEFAULT 'none'",
            "ALTER TABLE transactions ADD COLUMN external_id VARCHAR(100) DEFAULT ''",
            "ALTER TABLE holdings ADD COLUMN account_id INTEGER REFERENCES accounts(id)",
            "ALTER TABLE family_members ADD COLUMN sort_order INTEGER DEFAULT 0",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass

    # FamilyMember 已升级回一等模型，不再迁移到 Tag 体系
    # （历史 _migrate_members_to_tags 函数保留供调试，不再调用）


async def _migrate_members_to_tags():
    """
    将旧 family_members 表数据迁移到 TagCategory/Tag 体系。
    只在 tag_categories 表为空时执行（防止重复迁移）。
    """
    async with async_session() as db:
        # 检查是否已经迁移过
        result = await db.execute(text("SELECT COUNT(*) FROM tag_categories"))
        count = result.scalar()
        if count and count > 0:
            return  # 已迁移，跳过

        # 检查旧表是否存在且有数据
        try:
            result = await db.execute(text("SELECT id, name, avatar FROM family_members ORDER BY id"))
            members = result.fetchall()
        except Exception:
            members = []

        if not members:
            return  # 没有旧数据，由 seed 负责初始化

        # 创建"家庭成员"标签分类
        await db.execute(text(
            "INSERT INTO tag_categories (name, icon, sort_order) VALUES ('家庭成员', '👨‍👩‍👧‍👦', 0)"
        ))
        await db.commit()

        result = await db.execute(text("SELECT id FROM tag_categories WHERE name='家庭成员'"))
        cat_id = result.scalar()

        # 为每个成员创建 Tag，并建立 member_id → tag_id 映射
        member_tag_map: dict[int, int] = {}
        for i, (mid, name, avatar) in enumerate(members):
            icon = avatar if avatar else "👤"
            await db.execute(text(
                "INSERT INTO tags (name, icon, category_id, is_archived, sort_order) "
                "VALUES (:name, :icon, :cat_id, 0, :order)"
            ), {"name": name, "icon": icon, "cat_id": cat_id, "order": i})
            await db.commit()
            result = await db.execute(text("SELECT id FROM tags WHERE name=:name"), {"name": name})
            tid = result.scalar()
            member_tag_map[mid] = tid

        # 迁移 transactions.member_id → transaction_tags
        result = await db.execute(text(
            "SELECT id, member_id FROM transactions WHERE member_id IS NOT NULL"
        ))
        for txn_id, mid in result.fetchall():
            tid = member_tag_map.get(mid)
            if tid:
                try:
                    await db.execute(text(
                        "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (:tid_txn, :tid_tag)"
                    ), {"tid_txn": txn_id, "tid_tag": tid})
                except Exception:
                    pass

        # 迁移 accounts.member_id → account_tags
        result = await db.execute(text(
            "SELECT id, member_id FROM accounts WHERE member_id IS NOT NULL"
        ))
        for acc_id, mid in result.fetchall():
            tid = member_tag_map.get(mid)
            if tid:
                try:
                    await db.execute(text(
                        "INSERT OR IGNORE INTO account_tags (account_id, tag_id) VALUES (:aid, :tid)"
                    ), {"aid": acc_id, "tid": tid})
                except Exception:
                    pass

        # 迁移 holdings.member_id → holding_tags
        result = await db.execute(text(
            "SELECT id, member_id FROM holdings WHERE member_id IS NOT NULL"
        ))
        for hid, mid in result.fetchall():
            tid = member_tag_map.get(mid)
            if tid:
                try:
                    await db.execute(text(
                        "INSERT OR IGNORE INTO holding_tags (holding_id, tag_id) VALUES (:hid, :tid)"
                    ), {"hid": hid, "tid": tid})
                except Exception:
                    pass

        await db.commit()
