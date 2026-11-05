# Procedural Space Economy

An in-progress multiplayer space-game project. The first implementation milestone is a **player-funded, regional order-book bazaar**: no market stock, orders, or credits are seeded by the bazaar. Game services must explicitly register accounts and record player-earned deposits.

## Bazaar engine (Python 3.11+)

The standard-library implementation is in `src/spacegame/bazaar.py`. It supports regional markets, escrowed limit orders, immediate orders, FIFO price-time matching, cancellation, a JSONL command WAL with replay, and OHLCV/depth snapshots.

Run the tests from the repository root:

```bash
python -m unittest discover -s tests -v
```

This is a backend domain engine, not yet connected to a network API or 3D client. The earlier browser-prototype claim was premature: the existing `index.html` is not present, and files had been committed under incorrect names. Those files are corrected in this commit; the browser game remains future work.

See [the bazaar design and operating assumptions](docs/bazaar.md) and [the broader game architecture](docs/architecture.md).
