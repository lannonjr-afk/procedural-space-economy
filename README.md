# Procedural Space Economy

An in-progress browser space-exploration game and player-driven regional bazaar backend. The current local gameplay milestone includes larger celestial bodies, system-specific trade hubs, flight, surveys, finite-resource mining, and browser-local save data.

## Run locally

Requires a WebGL-capable browser and an internet connection for the Three.js module. From the repository root, run `python3 -m http.server 8000` and open <http://localhost:8000/>. Click the scene to capture the mouse.

Controls: **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **R/Ctrl** up/down, **E** survey near a planet, **M** mine close to a planet, **T** dock at a hub, **J** jump systems, or click **Guide to trade hub** for local autopilot.

Planet radii and star sizes are greatly increased, with wider system spacing. Each generated system now has a distinctive procedurally assembled trade station; docking range opens a regional exchange information panel. Hub designs and names vary by system seed.

## Important gameplay status

The trade hub is currently a generated visual landmark and local UI. Its order book correctly has no seeded liquidity, but it does not yet submit orders to the Python bazaar or connect players. Mining and localStorage saves are client-side and are not authoritative. This is still a prototype, not a finished multiplayer game.

Python bazaar and universe references are in `src/spacegame/`; run available tests with `python -m unittest discover -s tests -v`.
