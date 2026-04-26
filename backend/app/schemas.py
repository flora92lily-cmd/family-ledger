from pydantic import BaseModel
from datetime import date, datetime
from datetime import date as Date   # alias 避免与字段名 `date` 冲突
from typing import Optional


# ─── TagCategory ──────────────────────────────────────────────────────────────

class TagCategoryCreate(BaseModel):
    name: str
    icon: str = "🏷️"
    sort_order: int = 0

class TagCategoryUpdate(TagCategoryCreate):
    pass

class TagCategoryOut(BaseModel):
    id: int
    name: str
    icon: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Tag ──────────────────────────────────────────────────────────────────────

class TagCreate(BaseModel):
    name: str
    icon: str = "🏷️"
    category_id: int
    sort_order: int = 0

class TagUpdate(BaseModel):
    name: str
    icon: str = "🏷️"
    sort_order: int = 0

class TagOut(BaseModel):
    id: int
    name: str
    icon: str
    category_id: int
    is_archived: bool
    sort_order: int
    created_at: datetime
    category: Optional[TagCategoryOut] = None

    model_config = {"from_attributes": True}

class TagBrief(BaseModel):
    """嵌套在交易/账户/持仓中的标签简要信息"""
    id: int
    name: str
    icon: str
    category_id: int
    is_archived: bool

    model_config = {"from_attributes": True}


# ─── FamilyMember ─────────────────────────────────────────────────────────────

class FamilyMemberCreate(BaseModel):
    name: str
    avatar: str = "👤"
    sort_order: int = 0

class FamilyMemberUpdate(FamilyMemberCreate):
    pass

class FamilyMemberOut(BaseModel):
    id: int
    name: str
    avatar: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}

class FamilyMemberBrief(BaseModel):
    """嵌套在交易/账户/持仓中的成员简要信息"""
    id: int
    name: str
    avatar: str

    model_config = {"from_attributes": True}


# ─── Category ─────────────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name: str
    icon: str = "📦"
    type: str  # "expense" or "income"
    keywords: str = ""
    parent_id: Optional[int] = None
    sort_order: int = 0

class CategoryOut(BaseModel):
    id: int
    name: str
    icon: str
    type: str
    keywords: str
    parent_id: Optional[int]
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}

class CategoryTree(CategoryOut):
    """带子分类的树形结构"""
    children: list["CategoryTree"] = []


# ─── Transaction ──────────────────────────────────────────────────────────────

class AccountBrief(BaseModel):
    """嵌套在交易中的账户简要信息"""
    id: int
    name: str
    icon: str
    category: str
    model_config = {"from_attributes": True}

class TransactionCreate(BaseModel):
    amount: float
    type: str  # "expense" / "income" / "transfer"
    description: str = ""
    counterparty: str = ""
    date: date
    source: str = "manual"
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    member_id: Optional[int] = None
    note: str = ""
    tag_ids: list[int] = []
    # 报销相关（创建/更新时可选传入）
    is_reimbursable: bool = False
    reimbursable_amount: float = 0
    reimbursement_status: str = "none"  # none / pending / done
    external_id: str = ""

class TransactionUpdate(BaseModel):
    """PATCH 更新交易（全部字段可选）"""
    amount: Optional[float] = None
    type: Optional[str] = None
    description: Optional[str] = None
    counterparty: Optional[str] = None
    date: Optional[date] = None
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    member_id: Optional[int] = None
    note: Optional[str] = None
    tag_ids: Optional[list[int]] = None
    is_reimbursable: Optional[bool] = None
    reimbursable_amount: Optional[float] = None

class TransactionOut(BaseModel):
    id: int
    amount: float
    type: str
    description: str
    counterparty: str
    date: date
    source: str
    category_id: Optional[int]
    account_id: Optional[int]
    to_account_id: Optional[int]
    member_id: Optional[int] = None
    note: str
    is_reimbursable: bool = False
    reimbursable_amount: float = 0
    reimbursement_status: str = "none"
    external_id: str = ""
    created_at: datetime
    category: Optional[CategoryOut] = None
    account: Optional[AccountBrief] = None
    to_account: Optional[AccountBrief] = None
    member: Optional[FamilyMemberBrief] = None
    tags: list[TagBrief] = []

    model_config = {"from_attributes": True}


# ─── Reimbursement Record ─────────────────────────────────────────────────────

class ReimbursementItemIn(BaseModel):
    """提交报销时的单条关联（MVP 默认 amount=原账单 reimbursable_amount）"""
    transaction_id: int
    amount: Optional[float] = None  # None 则后端默认用该交易的 reimbursable_amount

class ReimbursementItemOut(BaseModel):
    transaction_id: int
    amount: float
    # 关联交易的简要信息（便于前端展开）
    date: Optional[Date] = None          # 用 Date alias，避免与字段名 `date` 同名导致 Pydantic v2 解析异常
    description: Optional[str] = None
    category_name: Optional[str] = None
    category_icon: Optional[str] = None
    amount_paid: Optional[float] = None  # 原支出金额

class ReimbursementRecordCreate(BaseModel):
    date: date
    to_account_id: int
    total_amount: float
    note: str = ""
    transaction_ids: list[int]  # 关联的原支出交易 IDs（MVP 一起报销多笔）

class ReimbursementRecordOut(BaseModel):
    id: int
    date: date
    to_account_id: Optional[int]
    total_amount: float
    note: str
    source: str
    external_id: str
    created_at: datetime
    to_account: Optional[AccountBrief] = None
    items: list[ReimbursementItemOut] = []

    model_config = {"from_attributes": True}


# ─── Account ──────────────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    name: str
    icon: str = "🏦"
    category: str  # 资金账户 / 信用卡 / 充值账户 / 债务
    balance: float = 0
    member_id: Optional[int] = None
    note: str = ""
    sort_order: int = 0
    tag_ids: list[int] = []

class AccountUpdate(AccountCreate):
    pass

class AccountOut(BaseModel):
    id: int
    name: str
    icon: str
    category: str
    balance: float          # 初始余额（用户手动设置）
    current_balance: float  # 动态余额（= 初始余额 ± 关联交易）
    member_id: Optional[int] = None
    note: str
    sort_order: int
    created_at: datetime
    member: Optional[FamilyMemberBrief] = None
    tags: list[TagBrief] = []

    model_config = {"from_attributes": True}


# ─── Statistics ───────────────────────────────────────────────────────────────

class MonthlySummary(BaseModel):
    month: str
    total_income: float
    total_expense: float
    balance: float

class CategorySummary(BaseModel):
    category_name: str
    category_icon: str
    total: float
    percentage: float

class MemberSummary(BaseModel):
    """按家庭成员聚合（NULL → 未指定）"""
    member_id: Optional[int]
    member_name: str
    member_avatar: str
    total: float
    percentage: float
