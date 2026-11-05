# Procedural Space Economy

An in-progress multiplayer space-game project. Current milestones are a browser-based 3D space-exploration prototype and a player-funded regional bazaar backend.

## Explore the prototype

Requires a WebGL-capable browser and an internet connection for the Three.js module. From the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Click the scene to capture the mouse. **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **E** survey a nearby planet, and **J** jump to another generated star system.

See [the exploration milestone and limitations](docs/exploration.md).

## Player-driven bazaar backend

The Python 3.11+ domain engine is in `src/spacegame/bazaar.py`. Markets and newly registered accounts start empty. The engine includes escrowed limit orders, price-time matching, instant trades, cancellation, command WAL/replay, market depth, and OHLCV projections. See [bazaar design and operating assumptions](docs/bazaar.md).

Run Python tests from the repository root:

```bash
python -m unittest discover -s tests -v
```

## Important status

This is **not a complete multiplayer game**. The browser scene is client-only and does not connect to a server; exploration, survey, and system jumps are local prototype behavior. Procedural planets are displaced sphere meshes, not streamed volumetric terrain. There is no landing, mining inventory, account service, or integration between the exploration client and the bazaar yet. Multiplayer authority, persistence, deployment, and production hardening remain future work.
