"""钱迹（QianJi）账本 CSV 解析器

钱迹导出 CSV 格式：
- UTF-8 BOM
- 表头：ID, 时间, 分类, 二级分类, 类型, 金额, 币种, 账户1, 账户2, 备注,
        已报销, 手续费, 优惠券, 记账者, 账单标记, 标签, 账单图片, 关联账单
- 时间格式：M/D/YYYY H:MM
- 类型取值：支出 / 收入 / 还款 / 转账 / 报销 / 报销记录
  - 支出/收入 → 普通交易
  - 报销 → 可报销支出（is_reimbursable=True），账户1=扣款账户
  - 报销记录 → 报销到账记录（不建 Transaction，建 ReimbursementRecord），
              账户1=到账账户，关联账单=原报销支出的 ID
  - 还款/转账 → 跳过（转账在其他路径处理）
- 已报销列：值为"是" 表示该可报销支出已被报销；空表示待报销
- 标签：可作为家庭成员标识（前端可选用）
"""
import csv
from datetime import datetime
from app.parsers.base import BaseParser, ParsedTransaction, ParsedReimbursement


class QianjiParser(BaseParser):
    name = "qianji"

    def parse(self, file_bytes: bytes, filename: str = "") -> list:
        """返回混合列表：ParsedTransaction + ParsedReimbursement"""
        text = self._decode(file_bytes)
        lines = text.splitlines()
        if not lines:
            return []

        reader = csv.reader(lines)
        headers = [h.strip() for h in next(reader)]
        col = {
            "id": self._find_col(headers, ["ID"]),
            "time": self._find_col(headers, ["时间"]),
            "category": self._find_col(headers, ["分类"]),
            "subcategory": self._find_col(headers, ["二级分类"]),
            "type": self._find_col(headers, ["类型"]),
            "amount": self._find_col(headers, ["金额"]),
            "account": self._find_col(headers, ["账户1"]),
            "note": self._find_col(headers, ["备注"]),
            "reimbursed": self._find_col(headers, ["已报销"]),
            "tag": self._find_col(headers, ["标签"]),
            "linked": self._find_col(headers, ["关联账单"]),
        }

        items: list = []
        for row in reader:
            if not row or len(row) < 6:
                continue
            try:
                item = self._parse_row(row, col)
                if item:
                    items.append(item)
            except (ValueError, IndexError):
                continue
        return items

    def _decode(self, b: bytes) -> str:
        for enc in ("utf-8-sig", "utf-8", "gbk"):
            try:
                return b.decode(enc)
            except UnicodeDecodeError:
                continue
        return b.decode("utf-8", errors="ignore")

    def _find_col(self, headers: list[str], candidates: list[str]) -> int:
        # 严格相等优先，否则模糊
        for cand in candidates:
            for i, h in enumerate(headers):
                if h == cand:
                    return i
        for cand in candidates:
            for i, h in enumerate(headers):
                if cand in h:
                    return i
        return -1

    def _parse_row(self, row: list[str], col: dict):
        def safe(key):
            idx = col.get(key, -1)
            return row[idx].strip() if 0 <= idx < len(row) else ""

        type_str = safe("type")

        # 解析通用字段
        amount_str = safe("amount").replace(",", "").strip()
        try:
            amount = abs(float(amount_str))
        except ValueError:
            return None
        if amount == 0:
            return None

        time_str = safe("time")
        date_part = time_str.split()[0] if " " in time_str else time_str
        txn_date = None
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y/%m/%d"):
            try:
                txn_date = datetime.strptime(date_part, fmt).date()
                break
            except ValueError:
                continue
        if not txn_date:
            return None

        row_id = safe("id")
        linked_id = safe("linked")
        payment_method = safe("account")

        # 分支 1：报销记录 → ParsedReimbursement
        if type_str == "报销记录":
            return ParsedReimbursement(
                amount=amount,
                date=txn_date,
                payment_method=payment_method,
                note=safe("note"),
                external_id=row_id,
                linked_external_id=linked_id,
                raw=",".join(row)[:200],
            )

        # 分支 2：普通交易 / 报销支出
        if type_str == "支出":
            txn_type = "expense"
            is_reimbursable = False
        elif type_str == "收入":
            txn_type = "income"
            is_reimbursable = False
        elif type_str == "报销":
            txn_type = "expense"
            is_reimbursable = True
        else:
            # 还款 / 转账 跳过
            return None

        # 描述：二级分类 or 主分类
        sub = safe("subcategory")
        category = safe("category")
        description = sub or category

        note = safe("note")

        # 标签
        tag_str = safe("tag")
        tags = [t.strip() for t in tag_str.split(",") if t.strip()] if tag_str else []

        # 报销相关字段
        reimbursable_amount = 0.0
        reimbursement_status = "none"
        if is_reimbursable:
            reimbursable_amount = amount  # 乐观估计=实付金额（后续如果有关联报销记录，save 阶段会改写）
            reimbursed_flag = safe("reimbursed")
            reimbursement_status = "done" if reimbursed_flag == "是" else "pending"

        return ParsedTransaction(
            amount=amount,
            type=txn_type,
            date=txn_date,
            description=description,
            counterparty="",
            note=note,
            payment_method=payment_method,
            tags=tags,
            is_reimbursable=is_reimbursable,
            reimbursable_amount=reimbursable_amount,
            reimbursement_status=reimbursement_status,
            external_id=row_id,
            raw=",".join(row)[:200],
        )
