# -*- coding: utf-8 -*-
"""行情数据层：只做标的合约，全部使用真实数据，不做合成兜底。

数据源（本机实测可直连）：
- 主源：Gate.io 公共 REST（`api.gateio.ws`）报价 + K 线
- 备用：Binance 公共 REST（`api.binance.com`）

**设计原则：宁可报错，也不返回假数据。**
所有真实数据源都失败时抛 RuntimeError，接口层转成 503，
前端会显示「行情源不可用」而不是一张看起来像真的合成曲线。

时间约定：
- 返回的 candle 统一为 `[unix 秒, open, high, low, close, volume]`，按旧→新排列。
- 加密市场 7×24，没有休市与隔夜缺口，不需要按交易日聚合。
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone

import httpx

from ..config import MARKET_TIMEOUT

# ------------------------------------------------------------------ 标的目录

# 中文名 + 分类的「人工词典」。目录本身是动态的（Gate.io 上所有可交易的 USDT 对），
# 这里只负责把常见币种翻译成中文并归到人类看得懂的类别里；
# 词典里没有的币种回退成「代码 · 其他」，不会从目录里消失。
COIN_META: dict[str, tuple[str, str]] = {
    # 公链 / Layer1
    "BTC": ("比特币", "公链"),
    "ETH": ("以太坊", "公链"),
    "SOL": ("Solana", "公链"),
    "ADA": ("艾达币", "公链"),
    "TRX": ("波场", "公链"),
    "AVAX": ("雪崩协议", "公链"),
    "TON": ("Toncoin", "公链"),
    "DOT": ("波卡", "公链"),
    "NEAR": ("NEAR", "公链"),
    "APT": ("Aptos", "公链"),
    "SUI": ("Sui", "公链"),
    "SEI": ("Sei", "公链"),
    "ICP": ("Internet Computer", "公链"),
    "HBAR": ("Hedera", "公链"),
    "ALGO": ("Algorand", "公链"),
    "VET": ("唯链", "公链"),
    "EOS": ("EOS", "公链"),
    "NEO": ("小蚁", "公链"),
    "IOTA": ("IOTA", "公链"),
    "KAS": ("Kaspa", "公链"),
    "STX": ("Stacks", "公链"),
    "ATOM": ("Cosmos", "公链"),
    "ETC": ("以太坊经典", "公链"),
    "XTZ": ("Tezos", "公链"),
    "FLOW": ("Flow", "公链"),
    "MINA": ("Mina", "公链"),
    "ROSE": ("Oasis", "公链"),
    "CFX": ("Conflux", "公链"),
    "KAVA": ("Kava", "公链"),
    "ONE": ("Harmony", "公链"),
    "ZIL": ("Zilliqa", "公链"),
    "WAVES": ("Waves", "公链"),
    "QTUM": ("量子链", "公链"),
    "LSK": ("Lisk", "公链"),
    "ONT": ("本体", "公链"),
    "ICX": ("ICON", "公链"),
    "WAN": ("Wanchain", "公链"),
    "ELF": ("aelf", "公链"),
    "CKB": ("Nervos", "公链"),
    "XDC": ("XDC Network", "公链"),
    "KLAY": ("Kaia", "公链"),
    "KSM": ("Kusama", "公链"),
    "TIA": ("Celestia", "公链"),
    "DYM": ("Dymension", "公链"),
    "AVAIL": ("Avail", "公链"),
    "INJ": ("Injective", "公链"),
    # 支付
    "XRP": ("瑞波币", "支付"),
    "LTC": ("莱特币", "支付"),
    "BCH": ("比特现金", "支付"),
    "XLM": ("恒星币", "支付"),
    "DASH": ("达世币", "支付"),
    "BSV": ("比特币SV", "支付"),
    # 隐私
    "XMR": ("门罗币", "隐私"),
    "ZEC": ("Zcash", "隐私"),
    "SCRT": ("Secret", "隐私"),
    # 存储
    "FIL": ("Filecoin", "存储"),
    "AR": ("Arweave", "存储"),
    "STORJ": ("Storj", "存储"),
    "SC": ("Siacoin", "存储"),
    # 预言机
    "LINK": ("Chainlink", "预言机"),
    "PYTH": ("Pyth", "预言机"),
    "BAND": ("Band Protocol", "预言机"),
    "API3": ("API3", "预言机"),
    "TRB": ("Tellor", "预言机"),
    "DIA": ("DIA", "预言机"),
    # Layer2
    "ARB": ("Arbitrum", "Layer2"),
    "OP": ("Optimism", "Layer2"),
    "MATIC": ("Polygon", "Layer2"),
    "POL": ("Polygon", "Layer2"),
    "STRK": ("Starknet", "Layer2"),
    "ZK": ("zkSync", "Layer2"),
    "MNT": ("Mantle", "Layer2"),
    "IMX": ("Immutable", "Layer2"),
    "LRC": ("Loopring", "Layer2"),
    "METIS": ("Metis", "Layer2"),
    "BOBA": ("Boba", "Layer2"),
    "SKL": ("SKALE", "Layer2"),
    "CTSI": ("Cartesi", "Layer2"),
    # DeFi
    "UNI": ("Uniswap", "DeFi"),
    "AAVE": ("Aave", "DeFi"),
    "MKR": ("Maker", "DeFi"),
    "CRV": ("Curve", "DeFi"),
    "LDO": ("Lido", "DeFi"),
    "PENDLE": ("Pendle", "DeFi"),
    "COMP": ("Compound", "DeFi"),
    "SNX": ("Synthetix", "DeFi"),
    "SUSHI": ("SushiSwap", "DeFi"),
    "CAKE": ("PancakeSwap", "DeFi"),
    "JUP": ("Jupiter", "DeFi"),
    "RAY": ("Raydium", "DeFi"),
    "HYPE": ("Hyperliquid", "DeFi"),
    "AERO": ("Aerodrome", "DeFi"),
    "MORPHO": ("Morpho", "DeFi"),
    "ENA": ("Ethena", "DeFi"),
    "ETHFI": ("Ether.fi", "DeFi"),
    "1INCH": ("1inch", "DeFi"),
    "DYDX": ("dYdX", "DeFi"),
    "GMX": ("GMX", "DeFi"),
    "RUNE": ("THORChain", "DeFi"),
    # 模因
    "DOGE": ("狗狗币", "模因"),
    "SHIB": ("柴犬币", "模因"),
    "PEPE": ("Pepe", "模因"),
    "WIF": ("dogwifhat", "模因"),
    "BONK": ("Bonk", "模因"),
    "FLOKI": ("Floki", "模因"),
    "TRUMP": ("官方特朗普", "模因"),
    "BOME": ("Book of Meme", "模因"),
    "NEIRO": ("Neiro", "模因"),
    "DOGS": ("Dogs", "模因"),
    "PENGU": ("Pudgy Penguins", "模因"),
    "POPCAT": ("Popcat", "模因"),
    "BRETT": ("Brett", "模因"),
    "MOG": ("Mog Coin", "模因"),
    "TURBO": ("Turbo", "模因"),
    # AI
    "TAO": ("Bittensor", "AI"),
    "RENDER": ("Render", "AI"),
    "FET": ("Fetch.ai", "AI"),
    "WLD": ("Worldcoin", "AI"),
    "AGIX": ("SingularityNET", "AI"),
    "OCEAN": ("Ocean Protocol", "AI"),
    "AIOZ": ("AIOZ", "AI"),
    "ARKM": ("Arkham", "AI"),
    "VIRTUAL": ("Virtuals", "AI"),
    "AI16Z": ("ai16z", "AI"),
    # 游戏 / NFT
    "SAND": ("The Sandbox", "游戏"),
    "MANA": ("Decentraland", "游戏"),
    "AXS": ("Axie Infinity", "游戏"),
    "GALA": ("Gala", "游戏"),
    "ENJ": ("Enjin", "游戏"),
    "ILV": ("Illuvium", "游戏"),
    "GODS": ("Gods Unchained", "游戏"),
    "PRIME": ("Echelon Prime", "游戏"),
    "PIXEL": ("Pixels", "游戏"),
    "PORTAL": ("Portal", "游戏"),
    "YGG": ("Yield Guild", "游戏"),
    "BEAM": ("Beam", "游戏"),
    "APE": ("ApeCoin", "NFT"),
    "BLUR": ("Blur", "NFT"),
    "LOOKS": ("LooksRare", "NFT"),
    # RWA / 跨链 / 基础设施
    "ONDO": ("Ondo", "RWA"),
    "POLYX": ("Polymesh", "RWA"),
    "CFG": ("Centrifuge", "RWA"),
    "W": ("Wormhole", "跨链"),
    "ZRO": ("LayerZero", "跨链"),
    "STG": ("Stargate", "跨链"),
    "AXL": ("Axelar", "跨链"),
    "GRT": ("The Graph", "基础设施"),
    "THETA": ("Theta", "基础设施"),
    "ANKR": ("Ankr", "基础设施"),
    "LPT": ("Livepeer", "基础设施"),
    "SSV": ("SSV Network", "基础设施"),
    "EIGEN": ("EigenLayer", "基础设施"),
    # 平台币
    "BNB": ("币安币", "平台币"),
    "GT": ("GateToken", "平台币"),
    "OKB": ("OKB", "平台币"),
    "KCS": ("KuCoin", "平台币"),
    "CRO": ("Cronos", "平台币"),
    "LEO": ("UNUS SED LEO", "平台币"),
    "HT": ("HuobiToken", "平台币"),
    "MX": ("MX Token", "平台币"),
    "BGB": ("Bitget Token", "平台币"),
}

# 稳定币之间互相报价没有研究价值，直接从目录里剔除。
_STABLE_BASES = {
    "USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDD", "PYUSD",
    "USDE", "USD1", "USDG", "RLUSD", "EURT", "EUR", "GYEN",
}
# 杠杆代币（3L/3S/5L/5S）不是独立币种，混进来只会污染列表。
_LEVERAGED_RE = re.compile(r"(3L|3S|5L|5S)$")

# 目录缓存 5 分钟：币种上下架不频繁，没必要每次进页面都全量抓一遍。
_DIRECTORY_TTL = 300.0
_DIRECTORY_CACHE: tuple[float, list[dict]] | None = None
_DIRECTORY_LOOKUP: set[str] = set()


def _meta_for(symbol: str) -> tuple[str, str]:
    base = symbol[:-4] if symbol.upper().endswith("USDT") else symbol.upper()
    return COIN_META.get(base, (base, "其他"))


def _static_directory() -> list[dict]:
    """Gate 不可达时的兜底目录：只损失长尾币种，常见的都还在。"""
    items = [
        {
            "symbol": f"{base}USDT",
            "name": name,
            "sector": sector,
            "market": "crypto",
        }
        for base, (name, sector) in COIN_META.items()
    ]
    return sorted(items, key=lambda x: x["symbol"])

# 缓存：K 线 20 秒（够挡住重复点击），报价 2 秒（前端每 3 秒轮询一次）。
# 报价缓存必须小于前端轮询间隔，否则每次轮询都会拿到同一份缓存，界面看起来「不动」。
_KLINE_CACHE: dict[tuple, tuple[float, dict]] = {}
_KLINE_TTL = 20.0
_TICKER_CACHE: dict[tuple, tuple[float, dict]] = {}
_TICKER_TTL = 2.0
# 全市场快照缓存：目录和批量报价共用，避免重复打上游。
_ALL_TICKERS_CACHE: tuple[float, dict[str, dict]] | None = None

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

GATE_BASE = "https://api.gateio.ws/api/v4"
BINANCE_BASE = "https://api.binance.com/api/v3"


async def list_symbols(market: str = "all") -> list[dict]:
    """标的目录：Gate.io 全部可交易的 USDT 对，按 24H 成交额从高到低。

    动态拉取而不是写死名单，币种上下架不需要改代码；
    抓取失败时回退到 COIN_META 里的常见币种，保证页面至少可用。
    """
    if market not in ("all", "crypto"):
        return []

    global _DIRECTORY_CACHE, _DIRECTORY_LOOKUP
    now = time.time()
    if _DIRECTORY_CACHE and _DIRECTORY_CACHE[0] > now:
        return _DIRECTORY_CACHE[1]

    try:
        async with httpx.AsyncClient(timeout=MARKET_TIMEOUT, headers={"User-Agent": _UA}) as client:
            tickers = await _gate_all_tickers(client)
        items = []
        for symbol, t in tickers.items():
            name, sector = _meta_for(symbol)
            items.append({
                "symbol": symbol,
                "name": name,
                "sector": sector,
                "market": "crypto",
                "price": t["price"],
                "change_24h": t["change_24h"],
                "volume_24h": t["volume_24h"],
            })
        items.sort(key=lambda x: x["volume_24h"], reverse=True)
    except Exception:
        items = _static_directory()

    _DIRECTORY_LOOKUP = {x["symbol"] for x in items}
    _DIRECTORY_CACHE = (now + _DIRECTORY_TTL, items)
    return items


def get_symbol_info(symbol: str) -> dict | None:
    """单个标的元信息。目录还没加载时不做存在性校验，交给下游行情源判断。"""
    sym = symbol.upper()
    if _DIRECTORY_LOOKUP and sym not in _DIRECTORY_LOOKUP:
        return None
    name, sector = _meta_for(sym)
    return {"symbol": sym, "name": name, "sector": sector, "market": "crypto"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def market_state(market: str = "crypto") -> dict:
    """标的 7×24，没有盘前/盘后/休市。"""
    return {"label": "标的 7×24", "hint": "加密市场全天候交易，无休市跳空。", "open": True}


# ------------------------------------------------------------------ 报价


def _gate_pair(symbol: str) -> str:
    """BTCUSDT -> BTC_USDT（Gate 的交易对命名）"""
    if symbol.upper().endswith("USDT"):
        return f"{symbol[:-4].upper()}_USDT"
    return symbol.upper()


def _gate_row_to_ticker(row: dict, symbol: str, quoted_at: str) -> dict:
    return {
        "symbol": symbol,
        "market": "crypto",
        "price": float(row["last"]),
        "change_24h": float(row["change_percentage"]),
        "high_24h": float(row["high_24h"]),
        "low_24h": float(row["low_24h"]),
        "volume_24h": float(row["quote_volume"]),
        "source": "gate",
        "source_label": "Gate.io",
        "quoted_at": quoted_at,
        "quote_time": None,
    }


async def _gate_all_tickers(client: httpx.AsyncClient) -> dict[str, dict]:
    """一次请求拿回 Gate 全部现货报价。

    为什么不做「每个币种一个请求」：目录现在有上千个 USDT 对，
    逐个请求会串行几十秒；`/spot/tickers` 不带参数就是全量快照。
    """
    global _ALL_TICKERS_CACHE
    now = time.time()
    if _ALL_TICKERS_CACHE and _ALL_TICKERS_CACHE[0] > now:
        return _ALL_TICKERS_CACHE[1]

    r = await client.get(f"{GATE_BASE}/spot/tickers")
    r.raise_for_status()
    quoted_at = _now_iso()
    out: dict[str, dict] = {}
    for row in r.json():
        pair = str(row.get("currency_pair", ""))
        if not pair.endswith("_USDT"):
            continue
        base = pair[:-5]
        # 非 ASCII 代码、杠杆代币、稳定币都不作为独立标的展示
        if not base or not base.isascii():
            continue
        if base in _STABLE_BASES or _LEVERAGED_RE.search(base):
            continue
        try:
            out[f"{base}USDT"] = _gate_row_to_ticker(row, f"{base}USDT", quoted_at)
        except (KeyError, TypeError, ValueError):
            continue

    _ALL_TICKERS_CACHE = (now + 2.0, out)
    return out


async def _gate_ticker_one(client: httpx.AsyncClient, symbol: str) -> dict | None:
    pair = _gate_pair(symbol)
    r = await client.get(f"{GATE_BASE}/spot/tickers", params={"currency_pair": pair})
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    return _gate_row_to_ticker(rows[0], symbol.upper(), _now_iso())


async def _binance_ticker_one(client: httpx.AsyncClient, symbol: str) -> dict | None:
    r = await client.get(f"{BINANCE_BASE}/ticker/24hr", params={"symbol": symbol.upper()})
    r.raise_for_status()
    t = r.json()
    return {
        "symbol": symbol.upper(),
        "market": "crypto",
        "price": float(t["lastPrice"]),
        "change_24h": float(t["priceChangePercent"]),
        "high_24h": float(t["highPrice"]),
        "low_24h": float(t["lowPrice"]),
        "volume_24h": float(t["quoteVolume"]),
        "source": "binance",
        "source_label": "Binance",
        "quoted_at": _now_iso(),
        "quote_time": None,
    }


async def fetch_tickers(symbols: list[str], market: str = "crypto") -> dict[str, dict]:
    """批量报价。返回 {symbol: ticker}；取不到的标的不出现在结果里。"""
    symbols = list(dict.fromkeys(s.upper() for s in symbols))
    now = time.time()
    result: dict[str, dict] = {}
    missing: list[str] = []

    for s in symbols:
        cached = _TICKER_CACHE.get(s)
        if cached and cached[0] > now:
            result[s] = cached[1]
        else:
            missing.append(s)

    if not missing:
        return result

    async with httpx.AsyncClient(timeout=MARKET_TIMEOUT, headers={"User-Agent": _UA}) as client:
        # 先试一次全量快照：无论前端要 10 个还是 100 个币种，都只打上游一次。
        try:
            all_map = await _gate_all_tickers(client)
        except Exception:
            all_map = {}

        still_missing = []
        for s in missing:
            item = all_map.get(s)
            if item:
                result[s] = item
                _TICKER_CACHE[s] = (now + _TICKER_TTL, item)
            else:
                still_missing.append(s)

        # Gate 没有的币种（或 Gate 整体不可用）再退回 Binance 逐个取。
        for s in still_missing:
            try:
                item = await _binance_ticker_one(client, s)
            except Exception:
                item = None
            if item:
                result[s] = item
                _TICKER_CACHE[s] = (now + _TICKER_TTL, item)
    return result


async def fetch_ticker(symbol: str) -> dict | None:
    items = await fetch_tickers([symbol])
    return items.get(symbol.upper())


# ------------------------------------------------------------------ K 线


async def _fetch_gate_kline(symbol: str, interval: str, limit: int) -> dict:
    pair = _gate_pair(symbol)
    async with httpx.AsyncClient(timeout=MARKET_TIMEOUT, headers={"User-Agent": _UA}) as client:
        r = await client.get(
            f"{GATE_BASE}/spot/candlesticks",
            params={"currency_pair": pair, "interval": interval, "limit": limit},
        )
        r.raise_for_status()
        rows = r.json()
        ticker = await _gate_ticker_one(client, symbol)

    # Gate 行格式：[时间, 计价币成交额, 收盘, 最高, 最低, 开盘, 基础币成交量, 是否收盘]
    candles = [
        [int(x[0]), float(x[5]), float(x[3]), float(x[4]), float(x[2]), float(x[6])]
        for x in rows
    ]
    if len(candles) < 30:
        raise RuntimeError(f"Gate 返回 K 线不足：{symbol} {interval}")

    if ticker:
        last = ticker["price"]
        # 用实时成交价修正最后一根（未收盘）K 线，避免指标滞后一个周期
        candles[-1][4] = last
        candles[-1][2] = max(candles[-1][2], last)
        candles[-1][3] = min(candles[-1][3], last)
        stats = ticker
    else:
        last = candles[-1][4]
        stats = {
            "price": last,
            "change_24h": 0.0,
            "high_24h": max(c[2] for c in candles[-24:]),
            "low_24h": min(c[3] for c in candles[-24:]),
            "volume_24h": sum(c[5] for c in candles[-24:]),
        }

    return {
        "candles": candles[-limit:],
        "last": last,
        "change_24h": stats["change_24h"],
        "high_24h": stats["high_24h"],
        "low_24h": stats["low_24h"],
        "volume_24h": stats["volume_24h"],
        "source": "gate",
        "source_label": "Gate.io",
        "quote_time": None,
        "quoted_at": _now_iso(),
    }


async def _fetch_binance_kline(symbol: str, interval: str, limit: int) -> dict:
    async with httpx.AsyncClient(timeout=MARKET_TIMEOUT) as client:
        r = await client.get(
            f"{BINANCE_BASE}/klines",
            params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
        )
        r.raise_for_status()
        raw = r.json()
        t = await _binance_ticker_one(client, symbol)

    candles = [[int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])] for k in raw]
    if len(candles) < 30:
        raise RuntimeError(f"Binance 返回 K 线不足：{symbol} {interval}")
    candles[-1][4] = t["price"]
    return {
        "candles": candles[-limit:],
        "last": t["price"],
        "change_24h": t["change_24h"],
        "high_24h": t["high_24h"],
        "low_24h": t["low_24h"],
        "volume_24h": t["volume_24h"],
        "source": "binance",
        "source_label": "Binance",
        "quote_time": None,
        "quoted_at": _now_iso(),
    }


async def fetch_market(symbol: str, market: str = "crypto", interval: str = "1h", limit: int = 200) -> dict:
    """统一入口。只返回真实行情；所有数据源都失败时抛错。"""
    symbol = symbol.upper()
    key = (symbol, interval)
    now = time.time()
    cached = _KLINE_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    info = get_symbol_info(symbol) or {"symbol": symbol, "name": symbol, "sector": "其他", "market": "crypto"}

    sources = (
        ("Gate.io", lambda: _fetch_gate_kline(symbol, interval, limit)),
        ("Binance", lambda: _fetch_binance_kline(symbol, interval, limit)),
    )

    errors: list[str] = []
    data = None
    for label, loader in sources:
        try:
            data = await loader()
            break
        except Exception as exc:  # 逐源降级，最后把错误一次性抛给调用方
            errors.append(f"{label}: {exc}")

    if data is None:
        raise RuntimeError("行情源不可用 → " + "；".join(errors))

    result = {
        "symbol": symbol,
        "name": info["name"],
        "sector": info["sector"],
        "market": "crypto",
        "market_label": "标的合约",
        "interval": interval,
        **data,
        "state": market_state(),
    }
    _KLINE_CACHE[key] = (now + _KLINE_TTL, result)
    return result
