"""Single-writer price-time matching, constant-product pool, WAL, and OHLCV."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
import json
import os
from pathlib import Path
from bisect import bisect_left
from typing import TextIO


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class Kind(str, Enum):
    LIMIT = "limit"
    MARKET = "market"


@dataclass(frozen=True, slots=True)
class Order:
    order_id: str
    owner_id: str
    side: Side
    kind: Kind
    quantity: Decimal
    limit_price: Decimal | None = None


@dataclass(frozen=True, slots=True)
class Fill:
    maker_order_id: str
    taker_order_id: str
    price: Decimal
    quantity: Decimal


@dataclass(slots=True)
class _Level:
    price: Decimal
    orders: deque[tuple[Order, Decimal]]


class OrderBook:
    """Single-threaded book; caller must serialize commands for this market."""
    def __init__(self) -> None:
        self._bids: list[_Level] = []  # descending prices
        self._asks: list[_Level] = []  # ascending prices
        self._ids: set[str] = set()

    def _levels(self, side: Side) -> list[_Level]:
        return self._bids if side is Side.BUY else self._asks

    @staticmethod
    def _insert_level(levels: list[_Level], price: Decimal, side: Side) -> _Level:
        prices = [level.price for level in levels]
        key = -price if side is Side.BUY else price
        keys = [-p for p in prices] if side is Side.BUY else prices
        idx = bisect_left(keys, key)
        if idx < len(levels) and levels[idx].price == price:
            return levels[idx]
        level = _Level(price, deque())
        levels.insert(idx, level)
        return level

    def submit(self, order: Order) -> list[Fill]:
        if order.order_id in self._ids:
            raise ValueError("duplicate order id")
        if order.quantity <= 0:
            raise ValueError("quantity must be positive")
        if order.kind is Kind.LIMIT and (order.limit_price is None or order.limit_price <= 0):
            raise ValueError("limit order requires positive limit price")
        self._ids.add(order.order_id)
        remaining = order.quantity
        fills: list[Fill] = []
        opposite = self._levels(Side.SELL if order.side is Side.BUY else Side.BUY)
        while remaining > 0 and opposite:
            best = opposite[0]
            crosses = order.kind is Kind.MARKET or (
                order.limit_price is not None and
                (order.limit_price >= best.price if order.side is Side.BUY else order.limit_price <= best.price))
            if not crosses:
                break
            maker, maker_qty = best.orders[0]
            traded = min(remaining, maker_qty)
            fills.append(Fill(maker.order_id, order.order_id, best.price, traded))
            remaining -= traded
            maker_qty -= traded
            if maker_qty == 0:
                best.orders.popleft()
            else:
                best.orders[0] = (maker, maker_qty)
            if not best.orders:
                opposite.pop(0)
        if remaining > 0 and order.kind is Kind.LIMIT:
            assert order.limit_price is not None
            self._insert_level(self._levels(order.side), order.limit_price, order.side).orders.append((order, remaining))
        return fills

    def depth(self, side: Side) -> list[tuple[Decimal, Decimal]]:
        return [(level.price, sum((qty for _, qty in level.orders), Decimal(0))) for level in self._levels(side)]


@dataclass(slots=True)
class ConstantProductPool:
    reserve_base: Decimal
    reserve_quote: Decimal
    fee_rate: Decimal = Decimal("0.003")
    tariff_rate: Decimal = Decimal("0")
    sink_rate: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        if self.reserve_base <= 0 or self.reserve_quote <= 0:
            raise ValueError("reserves must be positive")
        if any(rate < 0 or rate >= 1 for rate in (self.fee_rate, self.tariff_rate, self.sink_rate)):
            raise ValueError("rates must be in [0, 1)")

    def buy_base(self, quote_in: Decimal) -> tuple[Decimal, Decimal]:
        """Return (base_out, total_fee_and_tariff); quote input increases quote reserve."""
        if quote_in <= 0:
            raise ValueError("input must be positive")
        fee = quote_in * self.fee_rate
        tariff = quote_in * self.tariff_rate
        effective = quote_in - fee - tariff
        if effective <= 0:
            raise ValueError("fees consume input")
        out = self.reserve_base * effective / (self.reserve_quote + effective)
        if out >= self.reserve_base:
            raise ValueError("insufficient pool liquidity")
        self.reserve_quote += quote_in - quote_in * self.sink_rate
        self.reserve_base -= out
        return out, fee + tariff


@dataclass(slots=True)
class Trade:
    timestamp_s: int
    price: Decimal
    volume: Decimal


class JsonlWal:
    """Minimal append-and-fsync WAL. Append succeeds before caller commits state."""
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: dict[str, str | int]) -> None:
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())


def ohlcv(trades: list[Trade], interval_s: int) -> list[dict[str, int | Decimal]]:
    """Aggregate ordered or unordered trades into epoch-aligned buckets."""
    if interval_s <= 0:
        raise ValueError("interval must be positive")
    buckets: dict[int, list[Trade]] = {}
    for trade in trades:
        buckets.setdefault((trade.timestamp_s // interval_s) * interval_s, []).append(trade)
    result = []
    for start, rows in sorted(buckets.items()):
        rows.sort(key=lambda t: t.timestamp_s)
        prices = [t.price for t in rows]
        result.append({"start_s": start, "open": prices[0], "high": max(prices),
                       "low": min(prices), "close": prices[-1],
                       "volume": sum((t.volume for t in rows), Decimal(0))})
    return result
