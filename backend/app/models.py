from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, Boolean, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


# ─── 多对多关联表 ───────────────────────────────────────────────────────────────

transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column("transaction_id", Integer, ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

account_tags = Table(
    "account_tags",
    Base.metadata,
    Column("account_id", Integer, ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

holding_tags = Table(
    "holding_tags",
    Base.metadata,
    Column("holding_id", Integer, ForeignKey("holdings.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

# 报销记录 ↔ 原支出交易（多对多，支持"一次报销关联多笔待报销"）
reimbursement_items = Table(
    "reimbursement_items",
    Base.metadata,
    Column("record_id", Integer, ForeignKey("reimbursement_records.id", ondelete="CASCADE"), primary_key=True),
    Column("transaction_id", Integer, ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True),
    Column("amount", Float, default=0),  # 该报销记录覆盖该笔交易的金额（MVP 默认=交易的 reimbursable_amount）
)


# ─── 标签系统 ──────────────────────────────────────────────────────────────────

class TagCategory(Base):
    """标签分类（抽屉），如"家庭成员"、"旅行"、"项目"等"""
    __tablename__ = "tag_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    icon = Column(String(10), default="🏷️")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    tags = relationship("Tag", back_populates="category", cascade="all, delete-orphan")


class Tag(Base):
    """标签（全局唯一名称，归属一个 TagCategory）"""
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False, unique=True)  # 全局唯一
    icon = Column(String(10), default="🏷️")
    category_id = Column(Integer, ForeignKey("tag_categories.id"), nullable=False)
    is_archived = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    category = relationship("TagCategory", back_populates="tags")


# ─── 家庭成员 ─────────────────────────────────────────────────────────────────

class FamilyMember(Base):
    """家庭成员：账单/账户/持仓的归属主体（NULL = 未指定/共有）"""
    __tablename__ = "family_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False, unique=True)
    avatar = Column(String(10), default="👤")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


# ─── 分类 ─────────────────────────────────────────────────────────────────────

class Category(Base):
    """支出/收入分类（支持二级）"""
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False)
    icon = Column(String(10), default="📦")
    type = Column(String(10), nullable=False)  # "expense" or "income"
    keywords = Column(Text, default="")  # 用于智能分类的关键词，逗号分隔
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)  # 二级分类
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    transactions = relationship("Transaction", back_populates="category")


# ─── 账户 ─────────────────────────────────────────────────────────────────────

class Account(Base):
    """资产账户"""
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)         # 账户名，如"招行储蓄卡"
    icon = Column(String(10), default="🏦")
    category = Column(String(20), nullable=False)      # 资金账户/信用卡/充值账户/债务/投资理财/银行理财
    balance = Column(Float, default=0)                 # 余额（资金账户/充值账户）或欠款（信用卡/债务，正数）
    member_id = Column(Integer, ForeignKey("family_members.id"), nullable=True)  # 归属家庭成员（NULL=未指定/共有）
    note = Column(String(500), default="")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    member = relationship("FamilyMember", foreign_keys=[member_id])
    tags = relationship("Tag", secondary=account_tags, lazy="select")


# ─── 交易 ─────────────────────────────────────────────────────────────────────

class Transaction(Base):
    """交易记录"""
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    amount = Column(Float, nullable=False)
    type = Column(String(10), nullable=False)  # "expense" or "income"
    description = Column(String(200), default="")
    counterparty = Column(String(100), default="")  # 交易对方
    date = Column(Date, nullable=False)
    source = Column(String(20), default="manual")  # manual/alipay/wechat/bank/other
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    member_id = Column(Integer, ForeignKey("family_members.id"), nullable=True)  # 归属家庭成员（NULL=未指定/共有）
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)    # 支出/收入来源账户
    to_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # 转账目标账户
    # 报销相关字段
    is_reimbursable = Column(Boolean, default=False)            # 是否标记为"可报销"
    reimbursable_amount = Column(Float, default=0)              # 预期报销金额（默认=amount）
    reimbursement_status = Column(String(10), default="none")   # none / pending / done
    external_id = Column(String(100), default="")               # 外部来源原始 ID（钱迹行 ID），用于去重 + 跨次导入配对
    created_at = Column(DateTime, server_default=func.now())

    category = relationship("Category", back_populates="transactions")
    account = relationship("Account", foreign_keys=[account_id])
    to_account = relationship("Account", foreign_keys=[to_account_id])
    member = relationship("FamilyMember", foreign_keys=[member_id])
    tags = relationship("Tag", secondary=transaction_tags, lazy="select")


# ─── 报销记录 ─────────────────────────────────────────────────────────────────

class ReimbursementRecord(Base):
    """报销记录：用户提交报销后的一条到账记录，可关联多笔原支出交易"""
    __tablename__ = "reimbursement_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)                         # 报销到账日期
    to_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # 到账账户
    total_amount = Column(Float, nullable=False)                # 实际到账金额
    note = Column(String(500), default="")
    source = Column(String(20), default="manual")               # manual / qianji
    external_id = Column(String(100), default="")               # 外部原始 ID（钱迹报销记录行 ID），去重用
    created_at = Column(DateTime, server_default=func.now())

    to_account = relationship("Account", foreign_keys=[to_account_id])
    # 关联的原支出交易（通过 reimbursement_items）
    transactions = relationship("Transaction", secondary=reimbursement_items, lazy="select")


# ─── 持仓 ─────────────────────────────────────────────────────────────────────

class Holding(Base):
    """投资持仓"""
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)           # 持仓名称（如"易方达蓝筹精选混合"）
    code = Column(String(20), default="")               # 代码（如"005827"或"sh600000"）
    asset_type = Column(String(10), nullable=False)     # "fund"|"stock"|"wealth"
    shares = Column(Float, default=0)                   # 份额/股数（理财产品填本金）
    cost_price = Column(Float, default=0)               # 成本价（元/份或元/股）
    current_price = Column(Float, default=0)            # 最新净值/价格
    current_value = Column(Float, default=0)            # 最新市值（current_price * shares）
    member_id = Column(Integer, ForeignKey("family_members.id"), nullable=True)  # 归属家庭成员（NULL=未指定/共有）
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # 绑定的投资理财账户（可选）
    risk_class = Column(String(20), default="other")  # cash/bond/mixed/equity/realestate/other
    note = Column(String(500), default="")
    price_updated_at = Column(DateTime, nullable=True)  # 行情最后更新时间
    created_at = Column(DateTime, server_default=func.now())

    account = relationship("Account")
    member = relationship("FamilyMember", foreign_keys=[member_id])
    tags = relationship("Tag", secondary=holding_tags, lazy="select")


# ─── 导入账单原始账户映射 ────────────────────────────────────────────────────────

class PaymentMethodMapping(Base):
    """记忆：导入账单时把 (source, raw_name) 映射到本应用账户。下次导入自动预填。"""
    __tablename__ = "payment_method_mappings"
    __table_args__ = (UniqueConstraint("source", "raw_name", name="uq_pmm_source_raw"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(20), nullable=False)        # alipay / wechat / bank_pdf / qianji / generic
    raw_name = Column(String(200), nullable=False, default="")  # 原始账户名；bank_pdf 等无 payment_method 用 ""
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    last_used_at = Column(DateTime, server_default=func.now())

    account = relationship("Account", foreign_keys=[account_id])


# ─── 商户分类记忆 ──────────────────────────────────────────────────────────────

class MerchantCategory(Base):
    """记忆：某个 counterparty（商户/对方） → category_id 映射，提升再次导入的自动分类准确率"""
    __tablename__ = "merchant_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    merchant = Column(String(200), nullable=False, unique=True)   # counterparty 原值
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    last_used_at = Column(DateTime, server_default=func.now())

    category = relationship("Category", foreign_keys=[category_id])


# ─── 循环记账规则 ───────────────────────────────────────────────────────────────

class RecurringRule(Base):
    """循环交易规则：按周期自动生成交易"""
    __tablename__ = "recurring_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 周期设置
    recurrence_type = Column(String(10), nullable=False)   # "weekly" | "monthly"
    recurrence_day = Column(Integer, nullable=False)        # weekly=1~7(周一~周日), monthly=1~31
    start_date = Column(Date, nullable=False)
    # 结束条件
    end_type = Column(String(10), nullable=False, default="never")  # "never" | "date" | "count"
    end_date = Column(Date, nullable=True)
    max_count = Column(Integer, nullable=True)
    executed_count = Column(Integer, nullable=False, default=0)
    # 交易模板
    type = Column(String(10), nullable=False)              # "expense" | "income" | "transfer"
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    to_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    amount = Column(Float, nullable=False)
    member_id = Column(Integer, ForeignKey("family_members.id"), nullable=True)
    description = Column(String(200), default="")
    tag_ids_json = Column(Text, default="[]")              # JSON array of tag IDs
    # 状态
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    category = relationship("Category")
    account = relationship("Account", foreign_keys=[account_id])
    to_account = relationship("Account", foreign_keys=[to_account_id])
    member = relationship("FamilyMember", foreign_keys=[member_id])
    executions = relationship("RecurringExecution", back_populates="rule", cascade="all, delete-orphan")


class RecurringExecution(Base):
    """记录每次循环生成的交易，用于去重和追溯"""
    __tablename__ = "recurring_executions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    rule_id = Column(Integer, ForeignKey("recurring_rules.id", ondelete="CASCADE"), nullable=False)
    transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    target_date = Column(Date, nullable=False)
    executed_at = Column(DateTime, server_default=func.now())

    rule = relationship("RecurringRule", back_populates="executions")


# ─── 资产快照 ──────────────────────────────────────────────────────────────────

class AccountSnapshot(Base):
    """每月账户余额快照（每月 1 日 00:30 自动生成）"""
    __tablename__ = "account_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "snapshot_date", name="uq_account_snapshot"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    snapshot_date = Column(Date, nullable=False)
    balance = Column(Float, nullable=False)  # current_balance at snapshot time
    created_at = Column(DateTime, server_default=func.now())

    account = relationship("Account")


class HoldingSnapshot(Base):
    """每月持仓快照（每月 1 日 00:30 自动生成）"""
    __tablename__ = "holding_snapshots"
    __table_args__ = (UniqueConstraint("holding_id", "snapshot_date", name="uq_holding_snapshot"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    holding_id = Column(Integer, ForeignKey("holdings.id", ondelete="CASCADE"), nullable=False)
    snapshot_date = Column(Date, nullable=False)
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    value = Column(Float, nullable=False)       # shares * price
    cost_total = Column(Float, nullable=False)  # shares * cost_price
    created_at = Column(DateTime, server_default=func.now())

    holding = relationship("Holding")
