"""支付宝账单 CSV 解析器

支付宝导出的 CSV 通常是 GBK 编码，前面有几行说明，真正的表头大约在第 5-25 行。
表头通常包含：交易时间、交易分类、交易对方、商品说明、收/支、金额、收/付款方式、交易状态、交易订单号
"""
import csv
import io
from datetime import datetime, date
from app.parsers.base import BaseParser, ParsedTransaction
from app.parsers.investment_detector import apply_detection


class AlipayParser(BaseParser):
    name = "alipay"

    def parse(self, file_bytes: bytes, filename: str = "") -> list[ParsedTransaction]:
        # 支付宝账单一般是 GBK 编码
        text = self._decode(file_bytes)
        lines = text.splitlines()

        # 找到表头行
        header_idx = self._find_header(lines)
        if header_idx < 0:
            return []

        reader = csv.reader(lines[header_idx:])
        headers = [h.strip() for h in next(reader)]

        # 字段位置（兼容不同版本表头）
        col = {
            "time": self._find_col(headers, ["交易时间", "交易创建时间"]),
            "type": self._find_col(headers, ["收/支", "收/支类型"]),
            "counterparty": self._find_col(headers, ["交易对方", "对方"]),
            "description": self._find_col(headers, ["商品说明", "商品名称"]),
            "amount": self._find_col(headers, ["金额", "金额（元）"]),
            "status": self._find_col(headers, ["交易状态"]),
            "payment_method": self._find_col(headers, ["收/付款方式", "付款方式", "支付方式"]),
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

        # 投资交易识别（蚂蚁财富基金买入/赎回 → 改成 transfer）
        for t in transactions:
            apply_detection(t, "alipay")

        return transactions

    def _decode(self, b: bytes) -> str:
        for enc in ("gbk", "gb18030", "utf-8-sig", "utf-8"):
            try:
                return b.decode(enc)
            except UnicodeDecodeError:
                continue
        return b.decode("utf-8", errors="ignore")

    def _find_header(self, lines: list[str]) -> int:
        for i, line in enumerate(lines):
            if "交易时间" in line and ("收/支" in line or "金额" in line):
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

        # 解析金额
        amount_str = safe_get("amount").replace(",", "").replace("¥", "").strip()
        try:
            amount = abs(float(amount_str))
        except ValueError:
            return None
        if amount == 0:
            return None

        # 交易状态过滤（已退款、交易关闭、失败 → 直接跳过，不在导入栏显示）
        status = safe_get("status")
        if status and any(k in status for k in ["退款", "关闭", "失败"]):
            return None

        # 收/支判断（含"不计收支"分支处理）
        type_str = safe_get("type")
        description = safe_get("description")
        default_unchecked = False
        if "收入" in type_str:
            txn_type = "income"
        elif "支出" in type_str:
            txn_type = "expense"
        elif "不计收支" in type_str:
            # 余额宝转入按收入处理（用户明确认可）
            if "余额宝" in description:
                txn_type = "income"
            else:
                # 其他不计收支：作为支出兜底，但默认不勾选，让用户决定
                txn_type = "expense"
                default_unchecked = True
        else:
            return None

        # 解析时间（兼容 2026-04-27 与 2026/4/27 两种格式）
        time_str = safe_get("time")
        date_part = time_str.split()[0] if time_str else ""
        txn_date = None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
            try:
                txn_date = datetime.strptime(date_part, fmt).date()
                break
            except ValueError:
                continue
        if txn_date is None:
            return None

        return ParsedTransaction(
            amount=amount,
            type=txn_type,
            date=txn_date,
            description=description,
            counterparty=safe_get("counterparty"),
            payment_method=safe_get("payment_method"),
            default_unchecked=default_unchecked,
            raw=",".join(row)[:200],
        )
