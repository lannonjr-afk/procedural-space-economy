# Space exploration milestone

This milestone adds a browser-based 3D exploration scene and deterministic universe primitives.

## Run the scene

The browser module imports Three.js from jsDelivr, so an internet connection is required. From the repository root, run:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a WebGL-capable browser. Click the scene to capture the pointer. Controls: **WASD** thrust, **mouse** steer, **Space** brake, **Shift** boost, **E** survey when within 32 km, and **J** or the jump button to generate the next deterministic system.

Planets are generated from a system seed with multi-octave 3D value noise displacement. The scene provides a star, orbit paths, ambient star field, ship movement, system transitions, proximity targeting, and repeatable survey results. The Python `universe.py` module separately models deterministic sector coordinates and system descriptors using the shared 64-bit spatial hash and existing terrain SDF sampler.

## Coordinate strategy

The Python world model stores signed 64-bit sector anchors and bounded local offsets. Normalize local offsets by carrying whole sectors, then subtract a nearby origin before conversion to render-space floats. This avoids representing a cosmic absolute coordinate as one imprecise floating-point number. The current browser scene is a small local-scale prototype; its Three.js positions are not yet wired to `SectorPosition` or a server.

## Scope and next integration steps

This is an exploration prototype, not the complete multiplayer game: no authoritative multiplayer movement, persistent player identity, server validation, landing/walking, mesh LOD streaming, terrain collision, mining inventory, or bazaar API integration is included. The browser generates local visuals and survey messages only. The existing Python `terrain.py` provides a deterministic spherical SDF field; surface/volume chunk meshing and worker streaming remain follow-up tasks.
