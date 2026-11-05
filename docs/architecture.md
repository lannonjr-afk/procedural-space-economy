# procedural-space-economy
Technical blueprint and reference implementation for a procedural space exploration game with streamed planetary terrain, dynamic markets, and authoritative networking.

This project is under active construction. The bazaar backend milestone and design are documented in `docs/bazaar.md`; broader system architecture lives in this file.

## System architecture

```text
 procedural seed + coordinates ──> deterministic terrain workers ──> streamed client meshes
                                             │
 players ──> authoritative tick server ──> regional market sequencers
                   │                         │
             AOI snapshots              durable command/event log
                   └──────────┬──────────────┘
                       browser 3D client
```

The server is authoritative for movement, inventory, terrain edits, and trades. Clients send sequenced inputs and commands; they do not submit trusted positions, balances, or inventory. Stable seed/version/coordinate tuples define immutable procedural content. Player modifications are sparse server-validated deltas.

## Coordinate and terrain plan

Represent cosmic positions as signed integer sector coordinates plus bounded local coordinates. Subtract the camera's integer origin before conversion to render-space floats. Use cube-face planet tiles mapped through a spherified cube transform to avoid latitude/longitude singularities. Sample a deterministic 3D signed-distance field; Dual Contouring can produce volumetric overhangs/caves, while a balanced quadtree controls surface tile LOD. Canonical edge samples, transition meshes, and skirts address LOD cracks.

## Client streaming plan

Keep camera-relative rendering, cull quadtree/octree nodes against the view frustum, and choose LOD by projected geometric error. Generate meshes in workers using transferable typed-array buffers; tag results by generation to discard stale work. Use a byte-budget LRU and explicitly dispose GPU buffers on eviction. Prefer SoA render buffers for sequential upload and AoS for sparse entity edits.

## Server simulation and economy plan

Run a fixed authoritative tick, reconcile client prediction with acknowledged input sequences, and use snapshot interpolation for remote entities. Route updates through spatial AOI cells. Regional bazaars have independent books; trade and freight are player-originated. Each market is single-writer and WAL-backed. See `docs/bazaar.md` for current implementation details and constraints.

## Complexity and budgets

| Work | Complexity | Budget guidance |
|---|---:|---|
| Terrain samples | O(N·K), N samples and K noise octaves | Worker bounded chunks; never block render loop |
| Visible octree traversal | O(V) visited nodes | Frustum cull before descend |
| Order match | O(log P + F) ideal; current list level insertion O(P) + O(F) fills | Measure p95/p99; do not promise language-independent sub-ms |
| AOI publish | O(C + R) with cell index | Cap bandwidth and deduplicate recipients |

Target <16.6 ms total frame time at 60 FPS, reserving explicit per-frame upload budgets. These are engineering targets, not verified benchmarks. The current repository does not yet contain a 3D game client or multiplayer server.
