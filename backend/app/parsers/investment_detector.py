"""识别一条 ParsedTransaction 是否为"投资买入/赎回"，并提取基金/股票名称。

支付宝账单不含基金代码，只有名称（如"蚂蚁财富-天弘沪深300ETF联接C-买入"）。
所以 detector 只负责提取名称 + 动作；代码反查由后端 parse_bill 处理。

⚠️ A/C 类后缀必须保留（"联接C" 不能截断）。
"""
import re
from dataclasses import dataclass
from typing import Optional
from app.parsers.base import ParsedTransaction


@dataclass
class InvestmentInfo:
    action: str            # "buy" or "sell"
    asset_type: str        # "fund" or "stock"
    extracted_name: str    # 从描述里提取的基金/股票名
    extracted_code: str = ""  # 仅当账单格式恰好包含 6 位代码时才填


# 蚂蚁财富格式：'蚂蚁财富-{基金全名}-{动作}'
# 动作支持中英文连字符
_ALIPAY_ANT_PATTERN = re.compile(
    r"^蚂蚁财富[\-—](.+?)[\-—](买入|卖出|定投|申购|赎回)\s*$"
)

_BUY_ACTIONS = {"买入", "定投", "申购"}
_SELL_ACTIONS = {"卖出", "赎回"}


def _detect_alipay(txn: ParsedTransaction) -> Optional[InvestmentInfo]:
    """支付宝：counterparty 含'蚂蚁财富' + description 形如 蚂蚁财富-XX-买入"""
    cp = txn.counterparty or ""
    desc = txn.description or ""
    if "蚂蚁财富" not in cp and "蚂蚁财富" not in desc:
        return None

    # description 是首选源
    m = _ALIPAY_ANT_PATTERN.match(desc)
    if not m:
        # 有些版本的账单 counterparty=蚂蚁财富，description 只有基金名+动作
        # 兜底匹配 "{name}-{action}" 或 "{name} 买入"
        alt = re.match(r"^(.+?)[\-—](买入|卖出|定投|申购|赎回)\s*$", desc)
        if alt:
            name, action = alt.group(1).strip(), alt.group(2)
        else:
            return None
    else:
        name, action = m.group(1).strip(), m.group(2)

    if not name:
        return None

    if action in _BUY_ACTIONS:
        action_norm = "buy"
    elif action in _SELL_ACTIONS:
        action_norm = "sell"
    else:
        return None

    # 暂统一识别为 fund（蚂蚁财富主要是基金；股票走券商，不会进支付宝账单）
    return InvestmentInfo(action=action_norm, asset_type="fund", extracted_name=name)


def _detect_bank_pdf(txn: ParsedTransaction) -> Optional[InvestmentInfo]:
    """银行 PDF：description 含'申购'/'赎回'（含'基金快速赎回'等变体）/'证券保证金转出/入'/'证券+买入/卖出'。
    名称提取困难，留空让用户在前端选择 holding。
    注：理财类（朝朝盈/月月宝/理财申购 等）会在 apply_detection 的 _detect_bank_pdf_wealth 里先命中，
       走"普通 transfer 双账户选择器"分支，不会进到本函数。"""
    desc = txn.description or ""
    # 资产类型：含"证券"且不含"基金" → stock，其他默认 fund（最常见）
    def _asset_type() -> str:
        return "stock" if ("证券" in desc and "基金" not in desc) else "fund"

    # 买入类：申购 / 证券保证金转出 / 证券+买入
    if "申购" in desc or "证券保证金转出" in desc or ("证券" in desc and "买入" in desc):
        return InvestmentInfo(action="buy", asset_type=_asset_type(), extracted_name="")
    # 卖出类：赎回 / 证券保证金转入 / 证券+卖出
    if "赎回" in desc or "证券保证金转入" in desc or ("证券" in desc and "卖出" in desc):
        return InvestmentInfo(action="sell", asset_type=_asset_type(), extracted_name="")
    return None


# 银行理财关键词：申购与赎回共用一份。命中后只标 type=transfer，不写 detected_*，
# 让前端按普通 transfer 渲染（双账户选择器），方向交给用户选。
_BANK_WEALTH_KEYWORDS = (
    "朝朝宝", "朝朝盈", "月月宝",
    "购买理财", "理财申购", "理财认购", "理财购买", "理财赎回",
    "结构性存款",
)


def _detect_bank_pdf_wealth(txn: ParsedTransaction) -> bool:
    text = (txn.description or "") + " " + (txn.counterparty or "")
    return any(kw in text for kw in _BANK_WEALTH_KEYWORDS)


_DISPATCH = {
    "alipay": _detect_alipay,
    "bank_pdf": _detect_bank_pdf,
}


def detect_investment(txn: ParsedTransaction, source: str) -> Optional[InvestmentInfo]:
    """各 source 走对应 detector，识别失败返回 None。"""
    fn = _DISPATCH.get(source)
    if not fn:
        return None
    return fn(txn)


def apply_detection(txn: ParsedTransaction, source: str) -> None:
    """在解析时调用：识别为投资 → 改 type=transfer。
    - 公募基金/股票（蚂蚁财富、招行PDF基金/证券）：写 detected_* → 触发后续 holding 流程
    - 银行理财（仅 bank_pdf）：仅改 type=transfer，不写 detected_* → 走普通 transfer 双账户选择器
    """
    if source == "bank_pdf" and _detect_bank_pdf_wealth(txn):
        txn.type = "transfer"
        return
    info = detect_investment(txn, source)
    if not info:
        return
    txn.type = "transfer"
    txn.detected_action = info.action
    txn.detected_asset_type = info.asset_type
    txn.detected_name = info.extracted_name
    txn.detected_code = info.extracted_code
