import csv
import io
import unittest

from openpyxl import Workbook

from app.parsers.base import ParsedReimbursement, ParsedTransaction
from app.parsers.qianji import QianjiParser


HEADERS = [
    "ID", "时间", "账本", "分类", "二级分类", "类型", "金额", "币种",
    "账户1", "账户2", "备注", "已报销", "手续费", "优惠券", "记账者",
    "账单标记", "标签", "账单图片", "关联账单",
]


class QianjiParserTest(unittest.TestCase):
    def setUp(self):
        self.parser = QianjiParser()

    def _xlsx_bytes(self, rows):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(HEADERS)
        for row in rows:
            sheet.append(row)
        output = io.BytesIO()
        workbook.save(output)
        return output.getvalue()

    def test_parses_new_xlsx_export_with_added_ledger_column(self):
        row = [
            "qj-new-1", "2026-07-31 09:37:45", "日常账本", "四脚神兽", "纸尿裤",
            "支出", "77.82", "CNY", "招商银行 工资卡 1047", None, "京东", "", "",
            "", "记账者", None, "汤圆", None, "",
        ]

        items = self.parser.parse(self._xlsx_bytes([row]), "钱迹账本.xlsx")

        self.assertEqual(len(items), 1)
        txn = items[0]
        self.assertIsInstance(txn, ParsedTransaction)
        self.assertEqual(txn.external_id, "qj-new-1")
        self.assertEqual(str(txn.date), "2026-07-31")
        self.assertEqual(txn.amount, 77.82)
        self.assertEqual(txn.type, "expense")
        self.assertEqual(txn.description, "京东")
        self.assertEqual(txn.payment_method, "招商银行 工资卡 1047")
        self.assertEqual(txn.source_parent_category_name, "四脚神兽")
        self.assertEqual(txn.source_category_name, "纸尿裤")
        self.assertEqual(txn.tags, ["汤圆"])

    def test_xlsx_keeps_transfer_and_reimbursement_semantics(self):
        transfer = [
            "qj-transfer", "2026-07-30 10:00:00", "日常账本", "其它", "",
            "还款", 1000, "CNY", "储蓄卡", "信用卡", "", "", "", "", "", "",
            "家庭,共同", "", "",
        ]
        reimbursement = [
            "qj-reim", "2026-07-31 18:00:00", "日常账本", "其它", "",
            "报销记录", 88.5, "CNY", "工资卡", "", "到账", "", "", "", "", "",
            "", "", "qj-expense",
        ]

        items = self.parser.parse(self._xlsx_bytes([transfer, reimbursement]), "账本.xlsx")

        self.assertEqual(len(items), 2)
        txn = items[0]
        self.assertEqual(txn.type, "transfer")
        self.assertEqual(txn.payment_method, "储蓄卡")
        self.assertEqual(txn.to_payment_method, "信用卡")
        self.assertEqual(txn.description, "还款")
        self.assertEqual(txn.tags, ["家庭", "共同"])
        reim = items[1]
        self.assertIsInstance(reim, ParsedReimbursement)
        self.assertEqual(reim.linked_external_id, "qj-expense")
        self.assertEqual(reim.payment_method, "工资卡")

    def test_still_parses_legacy_csv_without_ledger_column(self):
        headers = [header for header in HEADERS if header != "账本"]
        row = [
            "qj-old-1", "7/29/2026 08:00", "日常生活", "三餐", "收入", "20", "CNY",
            "现金", "", "退款", "", "", "", "记账者", "", "家庭", "", "",
        ]
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerow(row)

        items = self.parser.parse(output.getvalue().encode("utf-8-sig"), "账本.csv")

        self.assertEqual(len(items), 1)
        txn = items[0]
        self.assertEqual(txn.type, "income")
        self.assertEqual(str(txn.date), "2026-07-29")
        self.assertEqual(txn.source_parent_category_name, "日常生活")
        self.assertEqual(txn.source_category_name, "三餐")


if __name__ == "__main__":
    unittest.main()
