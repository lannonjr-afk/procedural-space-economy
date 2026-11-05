# Player-driven bazaar design

## Economy rules

Each `(region, item)` book is lazily created and initially has zero bids and zero asks. Registering a player creates an account with **zero credits and zero items**. The bazaar never seeds stock, orders, credits, or fills. `deposit_credits` and `deposit_items` are explicit integration points for game services to record player-earned value; production callers must validate those rewards and prevent duplicate deposits using idempotency keys.

All prices are positive integer minor currency units and quantities are positive integers. This avoids binary floating-point settlement errors. Buy limits escrow `price × quantity`; sell limits escrow inventory. Crossing orders execute against the resting maker price, with FIFO priority within a price level. Any bid-price improvement is refunded to the buyer. Cancellation releases remaining escrow. Instant orders consume available depth and may partially fill; empty executable depth raises `EmptyBook` without state changes.

## Regions and freight

Regional books are isolated. A sell offer in system A cannot fill a buy order in system B. Players can buy low in one region and transport cargo to satisfy higher priced bids elsewhere, making distance, ship capacity, fuel, and risk part of the market. A global relay could later be modeled as an explicit player-owned courier service with fees and transit time—not as invisible shared liquidity.

## Matching and atomicity

Books use sorted price arrays (`bisect`) plus FIFO `deque`s. Best-price lookup is O(1); a new price level insertion/removal is O(P) due to Python list shifts, while matching F fills is O(F). Replace price arrays with a balanced tree/skip list for O(log P) level updates at larger scale. A single `asyncio.Lock` serializes commands across this reference engine and protects shared accounts. Before any mutation, the command is validated; accepted commands are appended to JSONL and `fsync` completes before the deterministic state transition is applied. Recovery replays journaled commands in order. This demonstrates write-ahead ordering but is not a substitute for a transactional database: production must handle WAL rotation/checksums, idempotency keys, crash injection tests, snapshots, backups, and atomic account/book persistence.

A live deployment should partition by region and route each market to one sequencer. Since player balances can span regions, settlement needs transactional escrow reservations (or a central account ledger) to avoid double spending across shards. Never use independent region locks with uncoordinated shared balances.

## Analytics and UI

Fill events are the source for interval OHLCV projections. The engine exposes `candle_data(region, item, interval_s)`; callers can request `60`, `3600`, and `86400` second windows. The output is epoch-aligned and contains open/high/low/close/total quantity. `depth(region, item)` returns sorted price/aggregate remaining quantity arrays. Production analytics should consume the durable event stream into indexed time-series storage and define late-event and retention policies.

## Verification and limitations

The tests cover empty liquidity, FIFO, price improvement, cancellation, regional isolation, partial instant fills, concurrent overspend prevention, and WAL replay. This domain module has no HTTP/WebSocket API, authentication, persistence database, game inventory integration, rate limiting, or 3D client. The rest of the game is not yet implemented.
