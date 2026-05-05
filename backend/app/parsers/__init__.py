"""账单解析器模块

每个解析器接收文件字节流，返回 List[ParsedTransaction]。
"""
from app.parsers.base import ParsedTransaction, ParsedReimbursement, BaseParser
from app.parsers.alipay import AlipayParser
from app.parsers.wechat import WechatParser
from app.parsers.generic_csv import GenericCsvParser
from app.parsers.bank_pdf import BankPdfParser
from app.parsers.qianji import QianjiParser
from app.parsers.jd import JdParser

PARSERS = {
    "alipay": AlipayParser(),
    "wechat": WechatParser(),
    "bank_pdf": BankPdfParser(),
    "qianji": QianjiParser(),
    "jd": JdParser(),
    "generic": GenericCsvParser(),
}


def get_parser(source: str) -> BaseParser:
    if source not in PARSERS:
        raise ValueError(f"Unknown source: {source}")
    return PARSERS[source]
