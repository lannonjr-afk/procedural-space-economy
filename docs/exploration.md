# Exploration gameplay milestone

This increment adds a local gameplay loop to the Three.js exploration scene:

1. Fly around a deterministic generated system.
2. Approach a planet and press **E** to survey its resource type, grade, and remaining finite deposit.
3. Move within 18 scene units and press **M** to mine one unit. The hold is capped at 40 units.
4. Discover additional planets/systems; mined cargo has no vendor that conjures currency or stock.
5. Surveys, cargo, and extraction progress are saved in browser local storage.

The local simulation still uses a small Three.js coordinate range (despite HUD labels using km), and clients can modify their local save. This is a prototype game loop only: terrain is a displaced sphere surface, not a streamed volumetric planet; there is no server authority, collision/landing, trading UI, or connection to `RegionalBazaar`.

## Next increments

- Add a Python HTTP/WebSocket server and move player position, mining claims, inventory, and account state server-side.
- Connect trading UI to the bazaar with authenticated, idempotent commands; keep market books empty until players place orders.
- Add actual chunked surface meshes / volumetric terrain and worker-based LOD streaming.
- Add persistence and deployment configuration, then verify using automated browser and multiplayer integration tests.
