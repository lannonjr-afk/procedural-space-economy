* {
  box-sizing: border-box;
}

:root {
  --bg-0: #07131d;
  --bg-1: #0b1d2b;
  --panel: rgba(9, 18, 26, 0.9);
  --panel-border: rgba(120, 220, 255, 0.28);
  --cyan: #7bdff2;
  --blue: #57a7ff;
  --green: #77f0b3;
  --gold: #ffd86b;
  --red: #ff8d8d;
  --text: #edf9ff;
  --muted: #a6bfd3;
}

html, body {
  margin: 0;
  height: 100%;
  font-family: "Segoe UI", Tahoma, sans-serif;
  background: radial-gradient(circle at top, #12273c 0%, var(--bg-0) 38%, #02070b 100%);
  color: var(--text);
}

body {
  min-height: 100vh;
}

.shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 360px;
  gap: 18px;
  min-height: 100vh;
  padding: 20px;
}

.panel, .viewport-wrap {
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 16px;
  box-shadow: 0 0 18px rgba(16, 33, 48, 0.65);
}

.panel {
  padding: 18px;
}

h1, h2 {
  margin: 0 0 10px;
  letter-spacing: 0.04em;
}

.subtitle {
  margin-top: 0;
  color: var(--muted);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}

.stat {
  padding: 10px 12px;
  background: rgba(123, 223, 242, 0.08);
  border: 1px solid rgba(123, 223, 242, 0.2);
  border-radius: 10px;
}

.stat span {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
}

.stat strong {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}

.section {
  margin-top: 18px;
}

ul {
  padding-left: 18px;
  color: var(--muted);
  margin: 8px 0 0;
}

li + li {
  margin-top: 6px;
}

#inventory, #market, .log {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inventory-row, .market-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 8px 10px;
}

.market-row button {
  background: linear-gradient(180deg, rgba(87, 167, 255, 0.28), rgba(87, 167, 255, 0.12));
  border: 1px solid rgba(87, 167, 255, 0.35);
  color: white;
  border-radius: 8px;
  padding: 6px 9px;
  cursor: pointer;
}

.market-row button.sell {
  background: linear-gradient(180deg, rgba(255, 141, 141, 0.28), rgba(255, 141, 141, 0.12));
  border-color: rgba(255, 141, 141, 0.35);
}

.viewport-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 16px;
  background: radial-gradient(circle at center, rgba(31, 53, 78, 0.85), rgba(2, 8, 14, 1));
}

.log {
  max-height: 220px;
  overflow: auto;
  font-size: 0.88rem;
  color: var(--muted);
}

.log-entry {
  border-left: 2px solid rgba(123, 223, 242, 0.4);
  padding-left: 8px;
}
