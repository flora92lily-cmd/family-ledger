"""通用 CSV 解析器 - 自动检测列名

支持自定义 CSV / Excel 导出。期望字段（任一种命名都可）：
- 日期 / date
- 金额 / amount
- 类型 / type ("expense"/"income"/"支出"/"收入")
- 描述 / description / desc / 商品 / 备注
- 对方 / counterparty / 商户

如果没有"类型"列，按金额正负判断（负数=支出）。
"""
import csv
from datetime import datetime
from app.parsers.base import BaseParser, ParsedTransaction


# 列名候选（小写匹配）
COL_DATE = ["日期", "date", "交易日期", "交易时间", "时间"]
COL_AMOUNT = ["金额", "amount", "金额(元)", "amount(rmb)"]
COL_TYPE = ["类型", "type", "收支", "收/支"]
COL_DESC = ["描述", "description", "desc", "商品", "商品说明", "摘要", "备注"]
COL_PARTY = ["对方", "counterparty", "商户", "交易对方", "对方账户"]


class GenericCsvParser(BaseParser):
    name = "generic"

    def parse(self, file_bytes: bytes, filename: str = "") -> list[ParsedTransaction]:
        text = self._decode(file_bytes)
        # 跳过 BOM 和空行
        lines = [l for l in text.splitlines() if l.strip()]
        if not lines:
            return []

        reader = csv.reader(lines)
        headers = [h.strip().lower() for h in next(reader)]

        col = {
            "date": self._find_col(headers, COL_DATE),
            "amount": self._find_col(headers, COL_AMOUNT),
            "type": self._find_col(headers, COL_TYPE),
            "desc": self._find_col(headers, COL_DESC),
            "party": self._find_col(headers, COL_PARTY),
        }

        if col["date"] < 0 or col["amount"] < 0:
            return []

        transactions = []
        for row in reader:
            if not row:
                continue
            try:
                txn = self._parse_row(row, col)
                if txn:
                    transactions.append(txn)
            except (ValueError, IndexError):
                continue
        return transactions

    def _decode(self, b: bytes) -> str:
        for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
            try:
                return b.decode(enc)
            except UnicodeDecodeError:
                continue
        return b.decode("utf-8", errors="ignore")

    def _find_col(self, headers: list[str], candidates: list[str]) -> int:
        for cand in candidates:
            for i, h in enumerate(headers):
                if cand.lower() in h:
                    return i
        return -1

    def _parse_row(self, row: list[str], col: dict) -> ParsedTransaction | None:
        def safe_get(key):
            idx = col.get(key, -1)
            return row[idx].strip() if 0 <= idx < len(row) else ""

        # 金额
        amount_raw = safe_get("amount").replace(",", "").replace("¥", "").strip()
        try:
            amount_val = float(amount_raw)
        except ValueError:
            return None
        if amount_val == 0:
            return None

        # 类型
        type_str = safe_get("type")
        if type_str:
            if any(k in type_str for k in ["收入", "income"]):
                txn_type = "income"
            elif any(k in type_str for k in ["支出", "expense"]):
                txn_type = "expense"
            else:
                txn_type = "expense" if amount_val < 0 else "income"
        else:
            txn_type = "expense" if amount_val < 0 else "income"

        # 日期
        date_str = safe_get("date").split()[0] if safe_get("date") else ""
        txn_date = None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
            try:
                txn_date = datetime.strptime(date_str, fmt).date()
                break
            except ValueError:
                continue
        if not txn_date:
            return None

        return ParsedTransaction(
            amount=abs(amount_val),
            type=txn_type,
            date=txn_date,
            description=safe_get("desc"),
            counterparty=safe_get("party"),
            raw=",".join(row)[:200],
        )
