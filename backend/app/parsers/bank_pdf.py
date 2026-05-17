"""银行账单 PDF 解析器（基于 word 坐标）

支持的格式：
- 招商银行个人交易流水（CMB）
  列 x 坐标固定：日期≈36, 货币≈98, 金额≈156, 余额≈234, 摘要≈307, 对手≈417
  对手信息列遇长字段会换行，wrap 行的 y 坐标距离 anchor 行 ≈ 6pt，
  相邻 anchor 间距 ≈ 26pt。

策略：
1. 用 pdfplumber.extract_words() 提取所有词及坐标
2. 按 y 坐标分行（容差 3pt）
3. 找出含日期的"锚定行"
4. 把每个非锚定行（wrap）归到最近的锚定行（y 距离 < 12pt）
"""
import re
import io
from datetime import date
import pdfplumber
from app.parsers.base import BaseParser, ParsedTransaction
from app.parsers.investment_detector import apply_detection


DATE_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")

# 招行 PDF 各列 x 坐标范围
COL_DATE_X = (20, 90)
COL_AMOUNT_X = (140, 220)
COL_SUMMARY_X = (300, 410)
COL_COUNTERPARTY_X = (410, 600)

WRAP_THRESHOLD_Y = 12  # 距离锚定行 12pt 以内的非锚定行视为延续

# 表头关键字（出现在 wrap 中说明是页眉/列标题，需要过滤）
HEADER_NOISE = ("对手信息", "Counter", "Party", "记账日期", "交易金额", "联机余额", "摘要", "货币", "Currency", "Amount", "Balance", "Date", "Description")


class BankPdfParser(BaseParser):
    name = "bank_pdf"

    def parse(self, file_bytes: bytes, filename: str = "") -> list[ParsedTransaction]:
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                all_rows = []  # list of (y, [words])
                for page in pdf.pages:
                    words = page.extract_words(x_tolerance=2, y_tolerance=2)
                    all_rows.extend(self._group_by_y(words, tolerance=3))
                return self._extract_transactions(all_rows)
        except Exception as e:
            print(f"PDF parse error: {e}")
            return []

    def _group_by_y(self, words: list, tolerance: float = 3) -> list[tuple[float, list]]:
        if not words:
            return []
        sorted_words = sorted(words, key=lambda w: (w["top"], w["x0"]))
        rows = []
        current_y = sorted_words[0]["top"]
        current_row = []
        for w in sorted_words:
            if abs(w["top"] - current_y) <= tolerance:
                current_row.append(w)
            else:
                rows.append((current_y, sorted(current_row, key=lambda x: x["x0"])))
                current_y = w["top"]
                current_row = [w]
        if current_row:
            rows.append((current_y, sorted(current_row, key=lambda x: x["x0"])))
        return rows

    def _is_anchor(self, row_words: list) -> bool:
        if not row_words:
            return False
        first = row_words[0]
        return COL_DATE_X[0] <= first["x0"] <= COL_DATE_X[1] and bool(DATE_RE.match(first["text"]))

    def _col_text(self, row_words: list, col_range: tuple[float, float]) -> str:
        return "".join(w["text"] for w in row_words if col_range[0] <= w["x0"] < col_range[1])

    def _extract_transactions(self, rows: list[tuple[float, list]]) -> list[ParsedTransaction]:
        # 分类每一行
        anchors = []  # [(y, words)]
        wraps = []    # [(y, words)]
        for y, ws in rows:
            if self._is_anchor(ws):
                anchors.append((y, ws))
            else:
                # 必须有对手列文本才算 wrap（避免噪音）
                cp_text = self._col_text(ws, COL_COUNTERPARTY_X)
                if not cp_text:
                    continue
                # 过滤表头噪音（页眉、列标题）
                if any(kw in cp_text for kw in HEADER_NOISE):
                    continue
                wraps.append((y, ws))

        # 把每个 wrap 归到最近的 anchor
        wrap_map = {i: {"before": [], "after": []} for i in range(len(anchors))}
        for wy, ww in wraps:
            # 找最近的 anchor
            nearest_idx = min(range(len(anchors)), key=lambda i: abs(anchors[i][0] - wy))
            ay = anchors[nearest_idx][0]
            if abs(ay - wy) > WRAP_THRESHOLD_Y:
                continue  # 距离太远，可能是噪音
            wrap_text = self._col_text(ww, COL_COUNTERPARTY_X)
            if wy < ay:
                wrap_map[nearest_idx]["before"].append((wy, wrap_text))
            else:
                wrap_map[nearest_idx]["after"].append((wy, wrap_text))

        transactions = []
        for i, (ay, aw) in enumerate(anchors):
            date_str = self._col_text(aw, COL_DATE_X)
            txn_date = self._parse_date(date_str)
            if not txn_date:
                continue

            amount_str = self._col_text(aw, COL_AMOUNT_X).replace(",", "")
            try:
                amount_val = float(amount_str)
            except ValueError:
                continue

            summary = self._col_text(aw, COL_SUMMARY_X)
            anchor_cp = self._col_text(aw, COL_COUNTERPARTY_X)

            before_parts = [t for _, t in sorted(wrap_map[i]["before"], key=lambda x: x[0])]
            after_parts = [t for _, t in sorted(wrap_map[i]["after"], key=lambda x: x[0])]
            counterparty = "".join(before_parts + [anchor_cp] + after_parts)

            txn_type = "income" if amount_val > 0 else "expense"
            # 自动识别信用卡还款 → transfer
            if any(kw in summary for kw in ("信用卡自动还款", "还款", "信用卡还款")):
                txn_type = "transfer"
            transactions.append(
                ParsedTransaction(
                    amount=abs(amount_val),
                    type=txn_type,
                    date=txn_date,
                    description=summary,
                    counterparty=counterparty[:100],
                    raw=f"{date_str} {amount_str} {summary} {counterparty}"[:200],
                )
            )

        # 投资交易识别（基金申购/赎回 / 证券交易 → 改 type=transfer）
        for t in transactions:
            # 已经识别为 transfer（如信用卡还款）的不再覆盖
            if t.type == "transfer":
                continue
            apply_detection(t, "bank_pdf")

        # 补齐 transfer 类交易的 counterparty（招行 PDF 多数情况 counterparty 为空，
        # 缺失会让商户记忆无法记账户方向。用 description 作回填 key —
        # "基金申购"/"基金赎回"/"信用卡自动还款" 等就成了稳定的记忆键）
        for t in transactions:
            if t.type == "transfer" and not t.counterparty and t.description:
                t.counterparty = t.description

        return transactions

    def _parse_date(self, s: str) -> date | None:
        m = DATE_RE.match(s.strip())
        if not m:
            return None
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
