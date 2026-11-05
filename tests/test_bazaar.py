"""Bazaar regression and recovery tests (standard library unittest)."""
import asyncio
import tempfile
import unittest
from pathlib import Path

from spacegame.bazaar import EmptyBook, InsufficientFunds, RegionalBazaar


class BazaarTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.market = RegionalBazaar()
        for player in ("buyer", "seller", "other"):
            await self.market.register_player(player)
        await self.market.deposit_credits("buyer", 10_000)
        await self.market.deposit_credits("other", 10_000)
        await self.market.deposit_items("seller", "iron", 20)

    async def test_empty_books_have_no_system_liquidity(self) -> None:
        self.assertEqual(self.market.depth("alpha", "iron"), {"bids": [], "asks": []})
        with self.assertRaises(EmptyBook):
            await self.market.instant_buy("alpha", "buyer", "iron", 1)
        self.assertEqual(self.market.accounts["buyer"].credits, 10_000)

    async def test_fifo_price_time_and_escrow_settlement(self) -> None:
        await self.market.sell_offer("alpha", "seller", "iron", 10, 5, "ask-1")
        await self.market.deposit_items("other", "iron", 5)
        await self.market.sell_offer("alpha", "other", "iron", 10, 5, "ask-2")
        fills = await self.market.instant_buy("alpha", "buyer", "iron", 7)
        self.assertEqual([(f.sell_order_id, f.quantity, f.price) for f in fills],
                         [("ask-1", 5, 10), ("ask-2", 2, 10)])
        self.assertEqual(self.market.accounts["buyer"].items["iron"], 7)
        self.assertEqual(self.market.accounts["buyer"].credits, 9_930)
        self.assertEqual(self.market.depth("alpha", "iron")["asks"], [(10, 3)])

    async def test_crossed_limit_order_matches_and_refunds_price_improvement(self) -> None:
        await self.market.sell_offer("alpha", "seller", "iron", 10, 4, "ask")
        fills = await self.market.buy_order("alpha", "buyer", "iron", 12, 3, "bid")
        self.assertEqual(fills[0].price, 10)
        self.assertEqual(self.market.accounts["buyer"].credits, 9_970)
        self.assertEqual(self.market.accounts["seller"].credits, 30)
        self.assertEqual(self.market.depth("alpha", "iron")["asks"], [(10, 1)])

    async def test_regional_markets_are_isolated_and_cancel_releases_escrow(self) -> None:
        await self.market.buy_order("alpha", "buyer", "iron", 7, 3, "bid")
        self.assertEqual(self.market.depth("alpha", "iron")["bids"], [(7, 3)])
        self.assertEqual(self.market.depth("beta", "iron"), {"bids": [], "asks": []})
        released = await self.market.cancel("alpha", "buyer", "bid")
        self.assertEqual(released, 3)
        self.assertEqual(self.market.accounts["buyer"].credits, 10_000)

    async def test_concurrent_orders_cannot_overdraw(self) -> None:
        await asyncio.gather(
            self.market.buy_order("alpha", "buyer", "iron", 100, 100, "b1"),
            self.market.buy_order("alpha", "buyer", "iron", 100, 100, "b2"),
        )
        self.assertEqual(self.market.accounts["buyer"].credits, 0)
        self.assertEqual(self.market.depth("alpha", "iron")["bids"], [(100, 100)])

    async def test_wal_replay_restores_accounts_orders_and_fills(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "bazaar.jsonl"
            market = RegionalBazaar(path)
            await market.register_player("buyer")
            await market.register_player("seller")
            await market.deposit_credits("buyer", 500)
            await market.deposit_items("seller", "iron", 3)
            await market.sell_offer("alpha", "seller", "iron", 20, 3, "ask")
            await market.instant_buy("alpha", "buyer", "iron", 2)
            recovered = RegionalBazaar(path)
            await recovered.recover()
            self.assertEqual(recovered.accounts["buyer"].credits, market.accounts["buyer"].credits)
            self.assertEqual(recovered.accounts["buyer"].items, market.accounts["buyer"].items)
            self.assertEqual(recovered.depth("alpha", "iron"), market.depth("alpha", "iron"))
            self.assertEqual(len(recovered.fills), len(market.fills))

    async def test_market_buy_partial_on_depth(self) -> None:
        await self.market.sell_offer("alpha", "seller", "iron", 10, 2, "ask")
        fills = await self.market.instant_buy("alpha", "buyer", "iron", 5)
        self.assertEqual(sum(f.quantity for f in fills), 2)
        self.assertEqual(self.market.accounts["buyer"].items["iron"], 2)
        with self.assertRaises(EmptyBook):
            await self.market.instant_buy("alpha", "buyer", "iron", 1)


if __name__ == "__main__":
    unittest.main()
