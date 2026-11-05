# Procedural Space Economy

An in-progress browser space exploration prototype with truly colossal celestial bodies.

## Run in Codespaces

In the repository root, run `python3 -m http.server 8000 --bind 0.0.0.0`, open the **Ports** tab, then open port 8000. Requires WebGL and internet access for the Three.js CDN module. After pulling a change, refresh the game tab; use a hard refresh if the browser cached an old module.

Stars are now **100,000–150,000 scene units in radius** and planets **50,000–100,000 units in radius**. The first spawn is near a planet and faces it so its scale is visible immediately. Orbits, camera range, ship size, and flight acceleration were also scaled to match; units are internally consistent gameplay units, not real kilometers.

Controls: **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **R/Ctrl** up/down, **E** survey near a planet, **M** mine finite deposits, **T** dock near a hub, **J** jump systems, or click **Guide to trade hub** for autopilot.

Each generated system has a distinct station design. Its bazaar UI is informational only and has no seeded liquidity; this browser client is not connected to the Python bazaar service or a multiplayer server. Cargo and survey/extraction saves are local to the browser.
