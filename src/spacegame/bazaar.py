"""Player-originated, regional, escrow-backed bazaar domain engine."""
from __future__ import annotations

import asyncio
from bisect import bisect_left
from collections import deque
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4


class BazaarError(Exception):
    """Base class for rejected bazaar commands."""


class EmptyBook(BazaarError):
    """No executable player orders exist on the requested side."""


class InsufficientFunds(BazaarError):
    pass


class InsufficientItems(BazaarError):
    pass


class InvalidOrder(BazaarError):
    pass


@dataclass(slots=True)
class Account:
    credits: int = 0
    items: dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class Order:
    order_id: str
    owner_id: str
    item: str
    side: str  # "buy" / "sell"
    price: int  # integer minor currency units per item
    remaining: int
    sequence: int


@dataclass(frozen=True, slots=True)
class Fill:
    region: str
    item: str
    price: int
    quantity: int
    buyer_id: str
    seller_id: str
    buy_order_id: str
    sell_order_id: str
    sequence: int
    timestamp_s: int


@dataclass
class _Book:
    bids: list[int] = field(default_factory=list)  # descending
    asks: list[int] = field(default_factory=list)  # ascending
    bid_levels: dict[int, deque[Order]] = field(default_factory=dict)
    ask_levels: dict[int, deque[Order]] = field(default_factory=dict)
    orders: dict[str, Order] = field(default_factory=dict)


class JsonlCommandWal:
    """Append-only command journal: every accepted command is fsynced before apply."""
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, command: dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(command, sort_keys=True, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    def commands(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        rows: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("command must be an object")
                    rows.append(value)
                except (json.JSONDecodeError, ValueError) as exc:
                    raise BazaarError(f"invalid WAL record at line {line_number}") from exc
        return rows


class RegionalBazaar:
    """Single-writer reference bazaar. Every region/item book starts empty.

    Cash and inventory deposits must represent explicit, externally validated player
    actions (for example earned credits or mined cargo); the bazaar creates neither.
    One asyncio lock protects shared accounts across regional books. A production
    service should shard commands and use transactional account reservations/storage.
    """
    def __init__(self, wal_path: str | Path | None = None) -> None:
        self.accounts: dict[str, Account] = {}
        self.books: dict[tuple[str, str], _Book] = {}
        self.fills: list[Fill] = []
        self._sequence = 0
        self._lock = asyncio.Lock()
        self._wal = JsonlCommandWal(wal_path) if wal_path is not None else None

    async def recover(self) -> None:
        """Rebuild state by replaying the complete command WAL into an empty engine."""
        if self._wal is None:
            raise BazaarError("recovery requires a WAL path")
        async with self._lock:
            if self.accounts or self.books or self.fills:
                raise BazaarError("recover must run on a fresh engine")
            for command in self._wal.commands():
                self._validate(command)
                self._apply(command)

    async def register_player(self, player_id: str) -> None:
        await self._commit({"op": "register", "player": player_id})

    async def deposit_credits(self, player_id: str, amount: int) -> None:
        """Record an explicit, validated player-earned credit deposit."""
        await self._commit({"op": "deposit_credits", "player": player_id, "amount": amount})

    async def deposit_items(self, player_id: str, item: str, quantity: int) -> None:
        """Record explicit player-originated items (e.g. validated mining output)."""
        await self._commit({"op": "deposit_items", "player": player_id, "item": item, "quantity": quantity})

    async def buy_order(self, region: str, player_id: str, item: str, price: int,
                        quantity: int, order_id: str | None = None) -> list[Fill]:
        command = {"op": "limit", "region": region, "player": player_id, "item": item,
                   "side": "buy", "price": price, "quantity": quantity,
                   "order_id": order_id or str(uuid4())}
        return await self._commit(command)

    async def sell_offer(self, region: str, player_id: str, item: str, price: int,
                         quantity: int, order_id: str | None = None) -> list[Fill]:
        command = {"op": "limit", "region": region, "player": player_id, "item": item,
                   "side": "sell", "price": price, "quantity": quantity,
                   "order_id": order_id or str(uuid4())}
        return await self._commit(command)

    async def instant_buy(self, region: str, player_id: str, item: str, quantity: int) -> list[Fill]:
        return await self._commit({"op": "market", "region": region, "player": player_id,
                                   "item": item, "side": "buy", "quantity": quantity})

    async def instant_sell(self, region: str, player_id: str, item: str, quantity: int) -> list[Fill]:
        return await self._commit({"op": "market", "region": region, "player": player_id,
                                   "item": item, "side": "sell", "quantity": quantity})

    async def cancel(self, region: str, player_id: str, order_id: str) -> int:
        return await self._commit({"op": "cancel", "region": region, "player": player_id,
                                   "order_id": order_id})

    async def _commit(self, command: dict[str, Any]) -> Any:
        async with self._lock:
            self._validate(command)
            if self._wal is not None:
                self._wal.append(command)
            return self._apply(command)

    def _validate(self, c: dict[str, Any]) -> None:
        op = c.get("op")
        if op == "register":
            if not isinstance(c.get("player"), str) or not c["player"] or c["player"] in self.accounts:
                raise BazaarError("invalid or already registered player")
            return
        player = c.get("player")
        if player not in self.accounts:
            raise BazaarError("player is not registered")
        if op == "deposit_credits":
            if not isinstance(c.get("amount"), int) or c["amount"] <= 0:
                raise BazaarError("credit deposit must be a positive integer")
        elif op == "deposit_items":
            if not c.get("item") or not isinstance(c.get("quantity"), int) or c["quantity"] <= 0:
                raise BazaarError("item deposit requires a name and positive integer quantity")
        elif op == "limit":
            if (not c.get("region") or not c.get("item") or c.get("side") not in ("buy", "sell")
                    or not isinstance(c.get("price"), int) or c["price"] <= 0
                    or not isinstance(c.get("quantity"), int) or c["quantity"] <= 0
                    or not c.get("order_id")):
                raise InvalidOrder("limit order fields must be positive and valid")
            book = self.books.get((c["region"], c["item"]))
            if book is not None and c["order_id"] in book.orders:
                raise InvalidOrder("duplicate active order id")
            account = self.accounts[player]
            if c["side"] == "buy" and account.credits < c["price"] * c["quantity"]:
                raise InsufficientFunds("not enough credits to escrow limit order")
            if c["side"] == "sell" and account.items.get(c["item"], 0) < c["quantity"]:
                raise InsufficientItems("not enough items to escrow sell offer")
        elif op == "market":
            if (not c.get("region") or not c.get("item") or c.get("side") not in ("buy", "sell")
                    or not isinstance(c.get("quantity"), int) or c["quantity"] <= 0):
                raise InvalidOrder("market order fields must be positive and valid")
            book = self.books.get((c["region"], c["item"]))
            levels = book.asks if book and c["side"] == "buy" else book.bids if book else []
            if not levels:
                raise EmptyBook("no player orders available on that side in this region")
            if c["side"] == "sell" and self.accounts[player].items.get(c["item"], 0) <= 0:
                raise InsufficientItems("no available items to sell")
        elif op == "cancel":
            book = self.books.get((c.get("region"), c.get("item", "")))
            order = book.orders.get(c.get("order_id")) if book else None
            # item is resolved by searching the requested region in _apply; validate there.
            if order is not None and order.owner_id != player:
                raise BazaarError("cannot cancel another player's order")
            if order is None and not any((r == c.get("region") and o.order_id == c.get("order_id") and o.owner_id == player)
                                         for (r, _), b in self.books.items() for o in b.orders.values()):
                raise BazaarError("active order not found")
        else:
            raise BazaarError("unknown command")

    def _book(self, region: str, item: str) -> _Book:
        return self.books.setdefault((region, item), _Book())

    @staticmethod
    def _add(book: _Book, order: Order) -> None:
        levels, prices = ((book.bid_levels, book.bids) if order.side == "buy"
                          else (book.ask_levels, book.asks))
        queue = levels.get(order.price)
        if queue is None:
            key = -order.price if order.side == "buy" else order.price
            keys = [-p for p in prices] if order.side == "buy" else prices
            prices.insert(bisect_left(keys, key), order.price)
            queue = levels[order.price] = deque()
        queue.append(order)
        book.orders[order.order_id] = order

    @staticmethod
    def _remove_if_empty(book: _Book, side: str, price: int) -> None:
        levels, prices = ((book.bid_levels, book.bids) if side == "buy"
                          else (book.ask_levels, book.asks))
        queue = levels.get(price)
        if queue is not None and not queue:
            del levels[price]
            prices.remove(price)

    def _apply(self, c: dict[str, Any]) -> Any:
        op = c["op"]
        if op == "register":
            self.accounts[c["player"]] = Account()
            return None
        if op == "deposit_credits":
            self.accounts[c["player"]].credits += c["amount"]
            return None
        if op == "deposit_items":
            account = self.accounts[c["player"]]
            account.items[c["item"]] = account.items.get(c["item"], 0) + c["quantity"]
            return None
        region, item, player = c.get("region"), c.get("item"), c["player"]
        account = self.accounts[player]
        book = self._book(region, item) if op in ("limit", "market") else None
        if op == "cancel":
            target = next((b.orders[c["order_id"]] for (r, _), b in self.books.items()
                           if r == region and c["order_id"] in b.orders), None)
            assert target is not None
            target_book = next(b for (r, _), b in self.books.items()
                               if r == region and c["order_id"] in b.orders)
            side = target.side
            if side == "buy":
                account.credits += target.price * target.remaining
            else:
                account.items[item if item else target.item] = account.items.get(target.item, 0) + target.remaining
            queue = target_book.bid_levels[target.price] if side == "buy'" else None
            levels = target_book.bid_levels if side == "buy" else target_book.ask_levels
            levels[target.price].remove(target)
            del target_book.orders[target.order_id]
            self._remove_if_empty(target_book, side, target.price)
            return target.remaining
        fills: list[Fill] = []
        timestamp_s = int(__import__("time").time())
        if op == "market":
            side = c["side"]
            requested = c["quantity"]
            book = self._book(region, item)
            remaining = requested
            if side == "buy":
                for price in list(book.asks):
                    if remaining <= 0:
                        break
                    affordable = account.credits // price
                    take = min(remaining, affordable, sum(o.remaining for o in book.ask_levels[price]))
                    if take:
                        incoming = Order("market:" + str(uuid4()), player, item, "buy", price, take, self._sequence + 1)
                        self._sequence += 1
                        fills.extend(self._match(book, incoming, price, take, region, item, timestamp_s))
                        remaining -= take
                if not fills:
                    raise InsufficientFunds("not enough credits for any available ask")
            else:
                available = account.items.get(item, 0)
                for price in list(book.bids):
                    if remaining <= 0:
                        break
                    take = min(remaining, available, sum(o.remaining for o in book.bid_levels[price]))
                    if take:
                        incoming = Order("market:" + str(uuid4()), player, item, "sell", price, take, self._sequence + 1)
                        self._sequence += 1
                        fills.extend(self._match(book, incoming, price, take, region, item, timestamp_s))
                        remaining -= take
                        available -= take
                if not fills:
                    raise InsufficientItems("no available bid or inventory")
            return fills
        side, price, quantity = c["side"], c["price"], c["quantity"]
        if side == "buy":
            account.credits -= price * quantity
        else:
            account.items[item] -= quantity
        incoming = Order(c["order_id"], player, item, side, price, quantity, self._sequence + 1)
        self._sequence += 1
        fills.extend(self._match(book, incoming, price, quantity, region, item, timestamp_s))
        if incoming.remaining:
            self._add(book, incoming)
        return fills

    def _match(self, book: _Book, incoming: Order, limit_price: int, quantity: int,
               region: str, item: str, timestamp_s: int) -> list[Fill]:
        fills: list[Fill] = []
        remaining = quantity
        opposite_prices = book.asks if incoming.side == "buy" else book.bids
        opposite_levels = book.ask_levels if incoming.side == "buy" else book.bid_levels
        while remaining and opposite_prices:
            best_price = opposite_prices[0]
            crosses = limit_price >= best_price if incoming.side == "buy" else limit_price <= best_price
            if not crosses:
                break
            queue = opposite_levels[best_price]
            maker = queue[0]
            traded = min(remaining, maker.remaining)
            buyer = incoming if incoming.side == "buy" else maker
            seller = maker if incoming.side == "buy" else incoming
            execution_price = maker.price
            buyer_account = self.accounts[buyer.owner_id]
            seller_account = self.accounts[seller.owner_id]
            # Buyer escrow is at their limit; refund the price improvement.
            buyer_account.credits += (buyer.price - execution_price) * traded
            seller_account.credits += execution_price * traded
            buyer_account.items[item] = buyer_account.items.get(item, 0) + traded
            buyer.remaining -= traded
            seller.remaining -= traded
            remaining -= traded
            if maker.remaining == 0:
                queue.popleft()
                del book.orders[maker.order_id]
            self._remove_if_empty(book, maker.side, best_price)
            self._sequence += 1
            fill = Fill(region, item, execution_price, traded, buyer.owner_id, seller.owner_id,
                        buyer.order_id, seller.order_id, self._sequence, timestamp_s)
            fills.append(fill)
            self.fills.append(fill)
        incoming.remaining = remaining
        return fills

    def depth(self, region: str, item: str) -> dict[str, list[tuple[int, int]]]:
        book = self.books.get((region, item), _Book())
        return {"bids": [(p, sum(o.remaining for o in book.bid_levels[p])) for p in book.bids],
                "asks": [(p, sum(o.remaining for o in book.ask_levels[p])) for p in book.asks]}

    def candle_data(self, region: str, item: str, interval_s: int, now_s: int | None = None) -> list[dict[str, int]]:
        """Return epoch-aligned OHLCV buckets from fill events for one market/item."""
        if interval_s <= 0:
            raise ValueError("interval must be positive")
        trades = [f for f in self.fills if f.region == region and f.item == item]
        buckets: dict[int, list[Fill]] = {}
        for fill in trades:
            buckets.setdefault(fill.timestamp_s // interval_s * interval_s, []).append(fill)
        rows: list[dict[str, int]] = []
        for start, fills in sorted(buckets.items()):
            rows.append({"start_s": start, "open": fills[0].price,
                         "high": max(f.price for f in fills), "low": min(f.price for f in fills),
                         "close": fills[-1].price, "volume": sum(f.quantity for f in fills)})
        return rows
