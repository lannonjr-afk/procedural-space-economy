# procedural-space-economy

Technical blueprint and reference implementation for a procedural space exploration game with streamed planetary terrain, dynamic markets, and authoritative networking.

## Play the prototype

This repository now includes a playable browser prototype of the game loop with:

- procedural star systems and planets
- ship movement and resource harvesting
- a dynamic market with buy/sell actions
- deterministic economic and terrain simulation hooks

### Run locally

From the repository root:

```bash
python3 -m http.server 8000
```

Then open:

- http://localhost:8000/

### Files

- `index.html` — browser game shell
- `style.css` — HUD and layout styling
- `game.js` — game loop, terrain generation, market simulation, controls
- `docs/architecture.md` — deep design and system blueprint
- `src/spacegame/` — Python reference models for generation, economy, and networking
