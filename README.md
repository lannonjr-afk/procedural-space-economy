# Procedural Space Economy

An in-progress browser space-exploration game and player-driven regional bazaar backend. The current playable milestone supports local flight, surveying, finite-resource mining, and browser-local save data.

## Run locally

Requires a WebGL-capable browser and an internet connection for the Three.js module. From the repository root:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Click the scene to capture the mouse. **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **Ctrl** descend, **E** survey, **M** mine within 18 km, and **J** jump systems.

Mining creates cargo only by extracting finite deposits generated with the system. Cargo, surveys, and extracted quantities save in browser local storage. There are no NPC trades or seeded credits; sale/market integration is a future milestone.

## Backend

The Python 3.11+ bazaar domain engine is in `src/spacegame/bazaar.py`; new accounts and markets start empty. Python universe and terrain reference modules are in `src/spacegame/`. Run tests with `python -m unittest discover -s tests -v`.

## Current limitations

This is not yet a full game or multiplayer build. The browser simulation is client-only, localStorage is not authoritative, and its seeded local system sequence is not secure or shared. There is no landing/walking, 3D terrain LOD/cave meshing, persistence server, multiplayer networking, or bazaar API integration. The current mine/survey loop is a local playable progression slice, not production persistence.
