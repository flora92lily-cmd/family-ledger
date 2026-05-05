"""京东交易流水 CSV 解析器

京东导出的 CSV：前面若干行为说明文字，真正表头约在第 22 行左右。
表头：交易时间,商户名称,交易说明,金额,收/付款方式,交易状态,收/支,交易分类,交易订单号,商家订单号,备注
特点：
- 时间字段末尾可能含 \t，需要 strip
- 只保留交易状态="交易成功"的行
- description = "商户名称，交易说明" 拼接
"""
import csv
import io
from datetime import datetime
from app.parsers.base import BaseParser, ParsedTransaction


class JdParser(BaseParser):
    name = "jd"

    def parse(self, file_bytes: bytes, filename: str = "") -> list[ParsedTransaction]:
        text = self._decode(file_bytes)
        lines = text.splitlines()

        header_idx = self._find_header(lines)
        if header_idx < 0:
            return []

        reader = csv.reader(lines[header_idx:])
        headers = [h.strip() for h in next(reader)]

        col = {
            "time":           self._find_col(headers, ["交易时间"]),
            "merchant":       self._find_col(headers, ["商户名称"]),
            "description":    self._find_col(headers, ["交易说明"]),
            "amount":         self._find_col(headers, ["金额"]),
            "payment_method": self._find_col(headers, ["收/付款方式", "付款方式"]),
            "status":         self._find_col(headers, ["交易状态"]),
            "type":           self._find_col(headers, ["收/支"]),
        }

        transactions = []
        for row in reader:
            if not row or len(row) < 3:
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

    def _find_header(self, lines: list[str]) -> int:
        for i, line in enumerate(lines):
            if "交易时间" in line and "商户名称" in line:
                return i
        return -1

    def _find_col(self, headers: list[str], candidates: list[str]) -> int:
        for cand in candidates:
            for i, h in enumerate(headers):
                if cand in h:
                    return i
        return -1

    def _parse_row(self, row: list[str], col: dict) -> ParsedTransaction | None:
        def safe_get(key):
            idx = col.get(key, -1)
            return row[idx].strip() if 0 <= idx < len(row) else ""

        # 只保留交易成功
        if safe_get("status") != "交易成功":
            return None

        # 收/支 → 交易类型
        type_str = safe_get("type")
        if "收入" in type_str:
            txn_type = "income"
        elif "支出" in type_str:
            txn_type = "expense"
        else:
            return None

        # 金额
        amount_str = safe_get("amount").replace(",", "").replace("¥", "").strip()
        try:
            amount = abs(float(amount_str))
        except ValueError:
            return None
        if amount == 0:
            return None

        # 日期
        time_str = safe_get("time")
        date_part = time_str.split()[0] if time_str else ""
        txn_date = None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                txn_date = datetime.strptime(date_part, fmt).date()
                break
            except ValueError:
                continue
        if txn_date is None:
            return None

        # 备注 = 商户名称 + 交易说明
        merchant = safe_get("merchant")
        desc = safe_get("description")
        if merchant and desc:
            description = f"{merchant}，{desc}"
        elif merchant:
            description = merchant
        else:
            description = desc

        return ParsedTransaction(
            amount=amount,
            type=txn_type,
            date=txn_date,
            description=description,
            counterparty=merchant,
            payment_method=safe_get("payment_method"),
            raw=",".join(row)[:200],
        )
