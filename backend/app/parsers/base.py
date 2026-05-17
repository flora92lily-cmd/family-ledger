"""解析器基类和通用数据结构"""
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Optional


@dataclass
class ParsedTransaction:
    """从账单文件解析出来的单条交易（未入库）"""
    amount: float
    type: str  # "expense" or "income"
    date: date
    description: str = ""
    counterparty: str = ""
    payment_method: str = ""  # 支付方式（如"招商银行储蓄卡(1234)"、"余额宝"、"花呗"）
    to_payment_method: str = ""  # 转入账户名（仅 type=transfer 且账单显式给出双账户时填，如钱迹"账户2"）
    raw: str = ""  # 原始行内容，便于调试
    tags: list = field(default_factory=list)  # 原始标签字符串列表（如钱迹的标签列）

    # 自动归类的结果（前端可改）
    category_id: Optional[int] = None
    category_name: Optional[str] = None  # 仅用于展示

    # 来源账单自带的分类名（如钱迹的二级分类/一级分类），categorizer 会优先按名直接匹配
    source_category_name: Optional[str] = None         # 优先（如钱迹的二级分类）
    source_parent_category_name: Optional[str] = None  # 备选（如钱迹的一级分类）

    # 报销相关（钱迹导入时填充）
    is_reimbursable: bool = False               # 类型=报销 → True
    reimbursable_amount: float = 0              # 预期报销金额（默认=amount）
    reimbursement_status: str = "none"          # none / pending / done（钱迹已报销=是 → done）
    external_id: str = ""                       # 原始 ID（钱迹行 ID）

    # 解析时建议默认不勾选（如支付宝"不计收支"且非余额宝转入），前端初始勾选时排除
    default_unchecked: bool = False

    # 投资交易识别（detector 在解析阶段标注，后端 parse_bill 后处理 + save 阶段使用）
    detected_action: str = ""           # "buy" / "sell" / ""
    detected_asset_type: str = ""       # "fund" / "stock" / ""
    detected_name: str = ""             # 提取的基金/股票名称
    detected_code: str = ""             # 提取的代码（很多账单没有，留空）
    target_holding_id: Optional[int] = None  # parse 阶段后端按名称匹配本地 holdings 后预填

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date"] = self.date.isoformat()
        return d


@dataclass
class ParsedReimbursement:
    """从账单文件解析出来的报销记录（钱迹类型=报销记录）"""
    amount: float                # 到账金额
    date: date                   # 到账日期
    payment_method: str = ""     # 账户1（到账账户）
    note: str = ""
    raw: str = ""
    external_id: str = ""        # 钱迹报销记录行 ID
    linked_external_id: str = "" # 关联账单列（指向原报销支出的 ID）

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date"] = self.date.isoformat()
        return d


class BaseParser:
    """解析器基类。子类必须实现 parse(file_bytes) -> List[ParsedTransaction]"""
    name: str = "base"

    def parse(self, file_bytes: bytes, filename: str = "") -> list[ParsedTransaction]:
        raise NotImplementedError
