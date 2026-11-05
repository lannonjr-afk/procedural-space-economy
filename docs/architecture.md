# Architecture blueprint

## System shape

```text
                         ┌──────────────┐
                         │  Seed service│  H(seed, signed integer coordinates)
                         └──────┬───────┘
                                │ immutable content IDs / parameters
                ┌───────────────┴────────────────┐
                ▼                                ▼
       Terrain workers                     Economy shards
  cube-face tiles → voxel SDF         market + AMM per commodity/location
  quadtree LOD / mesh buffers           WAL → replay → OHLCV projections
                │                                │
                └───────────────┬────────────────┘
                                ▼
                    authoritative simulation
                 fixed tick, validation, AOI routing
                                │
                     reliable + unreliable channels
                                ▼
               client prediction / reconciliation
                  floating origin / LRU / renderer
```

The server is authoritative for movement, inventory, trades, and edits. Clients may predict their own movement and render speculative edits, but submit inputs/commands rather than trusted state. Partition by stable system/market ID; a single market's matching sequence has one writer. Replicas consume its ordered event log. Terrain is deterministic from versioned seed + coordinates + generator version; edits are sparse authoritative deltas over that immutable base.

## Coordinates, seed, and terrain

Use a hierarchy of signed 64-bit sector coordinates plus bounded local coordinates, never a single floating-point cosmic position. For sector width `S`, normalize local coordinate into `[0,S)` and carry `floor(local/S)` into the integer sector. System and zone coordinates repeat this normalization at their own scale. Convert to float only after subtracting the camera's integer origin. A double precision server can maintain local simulation positions; render vertices remain camera-relative single precision.

For cube-face coordinate `(u,v) ∈ [-1,1]^2`, one low-distortion mapping is the spherified cube. For cube point `(x,y,z)`, map components as `x' = x√(1-y²/2-z²/2+y²z²/3)`, with cyclic expressions for `y'` and `z'`, then normalize and multiply by radius. This reduces area distortion versus naive cube normalization and avoids latitude/longitude pole singularities. Face-edge coordinates must use a shared canonical orientation and quantized integer edge keys so neighboring tiles evaluate identical samples.

The reference `terrain.py` implements deterministic 3D gradient noise, multi-octave fBm, domain warp, a radial elevation field, biome classification, and a subterranean signed-distance modifier. Sample the resulting signed-distance field on a chunk grid. A production mesher can use Marching Cubes (simple cell-local cases) or Dual Contouring: find edge sign crossings, estimate gradients by central differences, solve a regularized QEF per active cell, clamp the vertex to its cell, and connect vertices around sign-changing grid edges. A quadtree over cube-face surface tiles controls surface LOD; volumetric caves use an octree of 3D chunks. Balance adjacent leaves to at most one LOD difference before meshing.

At LOD boundaries, first prefer transition-cell tables (Transvoxel-style) using shared samples and canonical edge ownership. Skirts are a cheaper fallback: duplicate boundary vertices and extrude down by a screen-space-bounded depth. Skirts hide cracks but can overlap and are not a substitute for matching topology. Quantize boundary samples and derive normals from the same world-space field to prevent cracks and shading seams.

`spatial_hash()` is a stable 64-bit coordinate hash, not a cryptographic primitive. Its bits can seed independent parameter streams by applying a keyed mixer to `(seed, system, planet, parameter_tag)`. Version the hash and noise algorithms in save/protocol metadata; changing either changes worlds. The Python reference uses integer-coordinate inputs and has no persistence dependency.

## Streaming and rendering

The client stores integer sector + local offset and a nearby floating origin. Shift origin only at a threshold, subtract the delta from every active camera-relative transform, and notify physics/render workers in the same frame boundary. During atmospheric descent, smoothly change sector/zone scale while preserving the authoritative integer anchor; never repeatedly convert a huge absolute coordinate to `number`.

A worker owns its octree and mesh-generation queue. Main thread sends immutable camera/frustum snapshots and receives transferable typed-array buffers tagged with `(node id, generation)`. Discard stale generations. Cull by frustum planes, then choose LOD from projected geometric error (distance-only is a fallback). The TypeScript reference includes frustum traversal, an async task queue, floating-origin helper, and byte-budgeted LRU; production integration should transfer `ArrayBuffer`s and explicitly release GPU resources when evicting.

Spatial render batches should use SoA (separate position, normal, material, and index arrays) for sequential GPU upload and SIMD-friendly processing; AoS remains convenient for sparse edits and gameplay entities. Avoid per-node allocations in hot traversal. A DOD native extension may align hot arrays to cache lines and use arenas/SIMD, but the reference implementation stays Python/TypeScript.

## Economy and durability

For each commodity and location, maintain sorted price levels and FIFO queues at each level. The single-writer book matches crossing orders at the resting price; market orders never rest and may execute partially. Use integer minor currency units and fixed-point quantities in production; the reference uses decimal-safe `Decimal` prices and quantities. A market shard serializes commands; concurrent requests are sequenced before matching. Validate balances, limits, rate limits, and ownership before accepting an order.

The optional constant-product pool has reserves `x,y`, invariant `xy=k`, and fee-adjusted input `dx_net = dx(1-fee)`. Output is `y*dx_net/(x+dx_net)`. Bound input/output, apply location tariffs and dynamic fees before settlement, and route explicit sinks (tax/burn) separately from pool reserves. Never claim slippage controls alone prevent exploitation: enforce price bands, inventory/credit limits, cooldowns, and transaction-level anti-arbitrage policy.

Append a complete deterministic event (sequence, command, fills, balances delta) to a write-ahead log and `fsync` before publishing a successful response. Replay is idempotent by sequence/event ID; checkpoints are disposable snapshots. A production WAL needs checksummed framing, rotation, backups, and tested recovery. The reference JSONL WAL demonstrates append-before-commit for trade events. OHLCV buckets are projections from ordered trades, keyed by market/commodity/interval; regenerate projections from the log after a crash.

## Authoritative networking and AOI

Run fixed simulation ticks (for example 30 Hz) with monotonic tick IDs. Clients send sequenced input frames; server validates and simulates, then sends snapshots. Client predicts only its own craft, retains unacknowledged inputs, resets to the authoritative state, and replays inputs newer than the acknowledged sequence. Remote entities interpolate buffered snapshots; use bounded extrapolation only for short packet gaps. Land-edit commands are validated and broadcast as reliable ordered events; frequent transforms use unreliable sequenced snapshots. Trade acknowledgments/fills and inventory changes are reliable.

AOI uses a 3D grid keyed by integer cell coordinates. Each client subscribes to cells intersecting its radius; movement updates subscriptions incrementally. Publish to the union of subscribers for relevant cells, deduplicate recipients, and apply per-client bandwidth budgets. Use separate channels for reliable commands/events and unreliable latest-state updates. The reference AOI example favors clarity; a production implementation should use cell membership sets, not scan all clients.

```mermaid
sequenceDiagram
  participant C as Client
  participant S as Authoritative tick server
  participant M as Market shard
  C->>S: sequenced input / trade command
  S->>S: validate, simulate fixed tick
  S-->>C: unreliable snapshot + ack sequence
  C->>C: reconcile and replay pending inputs
  S->>M: validated, sequenced order
  M->>M: WAL append, match, commit
  M-->>S: fills and market event
  S-->>C: reliable fill to trader; AOI-scoped market update
```

## Schemas and budgets

Typed wire models should include `protocol_version`, `tick`, `entity_id`, `sequence`, integer sector coordinates, bounded local coordinates, and generator version. Trade events include unique ID, market/commodity, maker/taker order IDs, fixed-point price/quantity, timestamp, and monotonic market sequence. Terrain edits include author, operation ID, chunk key, quantized brush, and server revision.

| Operation | Time | Space | Target / notes |
|---|---:|---:|---|
| Noise/SDF samples | O(N·K) | O(1) per sample | N grid samples, K octaves; parallel worker chunks |
| Octree visible traversal | O(V) | O(depth) stack | V visited nodes; cull before child traversal |
| Limit order matching | O(log P + F) per insert/match | O(P + O) | P price levels, O resting orders, F fills; sorted-array level insertion can shift O(P), use tree/skip list for strict bounds |
| AOI publish | O(C + R) with cell index | O(C·cells) memberships | C relevant-cell candidates, R recipients; deduplicate by client ID |
| LRU eviction | O(log M) | O(M) | M entries; heap/map or linked hash map |

Frame target is <16.6 ms at 60 FPS; reserve a small fixed budget for streaming decisions (e.g. <1 ms), never block on disk/network, cap mesh uploads per frame, and profile on target hardware. Server fixed ticks must also have explicit budgets and backpressure; sub-millisecond matching is a benchmark goal, not a language-level guarantee. Measure p50/p95/p99 under contention and recovery load before setting service objectives.

## Reference implementation boundaries

The included modules are runnable teaching/reference components, not a production game server: terrain generates a field rather than triangle meshes; the market omits accounts/settlement integration; the WAL is a minimal JSONL demonstration; and the AOI server transport is intentionally abstract. Production requires authentication, abuse controls, durable storage, protocol compatibility, observability, load testing, and independent simulation/security review.
