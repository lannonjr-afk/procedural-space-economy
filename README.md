# Procedural Space Economy

An in-progress browser space exploration game with enormous celestial bodies and one unique procedural trade hub per generated solar system.

## Play in a Codespace

From the repository root, run `python3 -m http.server 8000 --bind 0.0.0.0`, open the **Ports** tab, then open port 8000 in a browser. Requires WebGL and internet access for the Three.js CDN module. After pulling changes, refresh the game tab; use a hard refresh if an old module remains cached.

The player now spawns near a nearby planet so the huge world visibly fills much of the view. Star radii are 12,000–18,000 scene units; planet radii are 4,200–14,000 units, with substantially wider orbit spacing. The camera far plane, framing, ship scale, and flight velocity are adjusted to these units rather than merely scaling the mesh.

Controls: **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **R/Ctrl** up/down, **E** survey near a planet, **M** mine finite deposits, **T** dock near a hub, **J** jump systems, or click **Guide to trade hub** for autopilot.

Each generated system has a distinct station style/name and a local docking information panel. The market panel is informational only and has no seeded liquidity; this client is not connected to the Python bazaar service or a multiplayer server. Cargo and survey/extraction data are browser-local prototype saves, not authoritative accounts.
