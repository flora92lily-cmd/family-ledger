"""行情价格服务

基金：东方财富 fundgz 接口（盘中估值，收盘后返回最终净值）
股票：腾讯财经 qt.gtimg.cn（A股，需传 sh600000 / sz000001 格式）
理财：无自动接口，手动维护

历史净值：东方财富 f10/lsjz（按日期范围）
基金搜索：东方财富 fundsuggest.eastmoney.com（按名称反查代码）
"""
import re
import json
import time
import asyncio
import urllib.parse
import urllib.request
from datetime import datetime, date as Date, timedelta
from typing import Optional


FUND_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "http://fund.eastmoney.com/",
}

STOCK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://gu.qq.com/",
}


def _normalize_stock_code(code: str) -> str:
    """将 600000 → sh600000，000001 → sz000001"""
    code = code.strip().lower()
    if code.startswith(("sh", "sz")):
        return code
    if code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def _fetch_fund_gz(code: str) -> Optional[dict]:
    """盘中估值（fundgz），如不可用返回 None"""
    url = f"http://fundgz.eastmoney.com/js/{code}.js?rt={int(time.time())}"
    req = urllib.request.Request(url, headers=FUND_HEADERS)
    text = urllib.request.urlopen(req, timeout=10).read().decode("utf-8-sig", errors="replace")
    m = re.search(r"jsonpgz\((\{.*?\})\)", text, re.DOTALL)
    if not m:
        return None
    data = json.loads(m.group(1))
    price_str = data.get("gsz") or data.get("dwjz")
    if not price_str:
        return None
    return {
        "price": float(price_str),
        "name": data.get("name", ""),
        "price_date": data.get("gztime") or data.get("jzrq") or "",
    }


def _fetch_fund_lsjz(code: str) -> dict:
    """历史净值接口（稳定，返回最近一个交易日的单位净值）"""
    url = f"http://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=1"
    headers = {**FUND_HEADERS, "Referer": f"http://fundf10.eastmoney.com/jjjz_{code}.html"}
    req = urllib.request.Request(url, headers=headers)
    text = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")
    payload = json.loads(text)
    lst = (payload.get("Data") or {}).get("LSJZList") or []
    if not lst:
        raise ValueError(f"基金 {code} 无净值数据")
    item = lst[0]
    dwjz = item.get("DWJZ")
    if not dwjz:
        raise ValueError(f"基金 {code} 净值为空")
    return {
        "price": float(dwjz),
        "name": "",  # 该接口不返回基金名
        "price_date": item.get("FSRQ", ""),
    }


def _fetch_fund(code: str) -> dict:
    """抓取基金净值：优先盘中估值（fundgz），失败则回退到历史净值（f10/lsjz）"""
    try:
        gz = _fetch_fund_gz(code)
        if gz:
            return gz
    except Exception:
        pass
    return _fetch_fund_lsjz(code)


def _fetch_stock(code: str) -> dict:
    """同步抓取 A 股行情（腾讯财经）"""
    full_code = _normalize_stock_code(code)
    url = f"https://qt.gtimg.cn/q={full_code}"
    req = urllib.request.Request(url, headers=STOCK_HEADERS)
    raw = urllib.request.urlopen(req, timeout=10).read()
    text = raw.decode("gbk", errors="replace")
    # 格式: v_sh600000="1~浦发银行~600000~9.88~..."
    m = re.search(r'"([^"]+)"', text)
    if not m:
        raise ValueError(f"股票 {code} 数据解析失败")
    parts = m.group(1).split("~")
    if len(parts) < 4:
        raise ValueError(f"股票 {code} 数据格式异常")
    return {
        "price": float(parts[3]),
        "name": parts[1],
        "price_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def _fetch_fund_nav_on(code: str, target_date: Date) -> Optional[float]:
    """查指定日期的基金净值。当日无（周末/节假日）时回退到前一个交易日。

    给 7 天回看窗口，取最新一条 ≤ target_date 的净值。
    """
    end = target_date.strftime("%Y-%m-%d")
    start = (target_date - timedelta(days=7)).strftime("%Y-%m-%d")
    url = (
        f"http://api.fund.eastmoney.com/f10/lsjz?fundCode={code}"
        f"&pageIndex=1&pageSize=10&startDate={start}&endDate={end}"
    )
    headers = {**FUND_HEADERS, "Referer": f"http://fundf10.eastmoney.com/jjjz_{code}.html"}
    req = urllib.request.Request(url, headers=headers)
    text = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")
    payload = json.loads(text)
    lst = (payload.get("Data") or {}).get("LSJZList") or []
    for item in lst:
        # lsjz 返回按日期降序
        dwjz = item.get("DWJZ")
        if dwjz:
            try:
                return float(dwjz)
            except ValueError:
                continue
    return None


async def fetch_fund_nav_on(code: str, target_date: Date) -> Optional[float]:
    """异步入口（在线程池中执行同步网络请求）。失败返回 None。"""
    if not code:
        return None
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch_fund_nav_on, code, target_date)
    except Exception:
        return None


def _search_fund_by_name(query: str) -> list[dict]:
    """按基金名/简称反查代码。返回最多 5 条 [{code, name}]。"""
    if not query:
        return []
    encoded = urllib.parse.quote(query)
    url = (
        f"https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx"
        f"?m=1&key={encoded}"
    )
    headers = {**FUND_HEADERS, "Referer": "https://fund.eastmoney.com/"}
    req = urllib.request.Request(url, headers=headers)
    text = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")
    payload = json.loads(text)
    datas = payload.get("Datas") or []
    results = []
    for item in datas[:5]:
        code = item.get("CODE") or ""
        name = item.get("NAME") or item.get("SHORTNAME") or ""
        if code and name:
            results.append({"code": code, "name": name})
    return results


async def search_fund_by_name(query: str) -> list[dict]:
    """异步入口。失败返回空列表。"""
    if not query:
        return []
    try:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _search_fund_by_name, query)
    except Exception:
        return []


async def fetch_price(asset_type: str, code: str) -> Optional[dict]:
    """
    异步入口（在线程池中执行同步网络请求）。
    返回 {"price": float, "name": str, "price_date": str} 或 None（出错时）
    """
    if asset_type == "wealth":
        return None  # 理财无自动行情
    if not code:
        return None
    try:
        loop = asyncio.get_event_loop()
        if asset_type == "fund":
            result = await loop.run_in_executor(None, _fetch_fund, code)
        elif asset_type == "stock":
            result = await loop.run_in_executor(None, _fetch_stock, code)
        else:
            return None
        return result
    except Exception as e:
        raise RuntimeError(f"行情获取失败 ({asset_type} {code}): {e}")
