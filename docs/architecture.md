const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const creditsEl = document.getElementById('credits');
const fuelEl = document.getElementById('fuel');
const sectorEl = document.getElementById('sector');
const targetEl = document.getElementById('target');
const inventoryEl = document.getElementById('inventory');
const marketEl = document.getElementById('market');
const logEl = document.getElementById('log');

const keys = {};
window.addEventListener('keydown', (event) => {
  keys[event.key.toLowerCase()] = true;
  if (event.code === 'Space') {
    event.preventDefault();
    mineResource();
  }
});
window.addEventListener('keyup', (event) => {
  keys[event.key.toLowerCase()] = false;
});

const marketCatalog = [
  { key: 'ore', name: 'Ore', base: 18, color: '#92d7ff' },
  { key: 'crystals', name: 'Crystals', base: 42, color: '#c7a6ff' },
  { key: 'fuel', name: 'Fuel', base: 12, color: '#ffd86b' },
  { key: 'alloys', name: 'Alloys', base: 33, color: '#9ae0b7' }
];

const state = {
  time: 0,
  player: {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fuel: 100,
    credits: 2500,
    cargo: { ore: 0, crystals: 0, fuel: 0, alloys: 0 },
    heading: 0
  },
  starfield: Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 2 + 0.5,
    alpha: Math.random() * 0.8 + 0.2
  })),
  sector: 'SOL-2',
  planets: [],
  market: Object.fromEntries(marketCatalog.map(item => [item.key, { price: item.base, volume: 80, trend: (Math.random() - 0.5) * 4 }]))
};

function hash2D(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function smoothNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2D(x0, y0, seed);
  const b = hash2D(x0 + 1, y0, seed);
  const c = hash2D(x0, y0 + 1, seed);
  const d = hash2D(x0 + 1, y0 + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fractalNoise(x, y, seed, octaves = 4) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    total += smoothNoise(x * frequency, y * frequency, seed + i * 13) * amplitude;
    sum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / sum;
}

function generatePlanets() {
  const planets = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + 2.4;
    const orbit = 200 + i * 90;
    const x = Math.cos(angle) * orbit;
    const y = Math.sin(angle) * orbit;
    const radius = 26 + i * 8;
    planets.push({
      id: i,
      x,
      y,
      radius,
      resource: ['ore', 'crystals', 'fuel', 'alloys'][i % 4],
      color: ['#7ed8ff', '#8ce0c3', '#ffd86b', '#c7a6ff'][i % 4],
      hue: 160 + i * 22,
      mass: 1 + i * 0.45,
      terrain: 0.5 + fractalNoise(x * 0.12 + 23.7, y * 0.12 + 11.4, 5 + i) * 0.7
    });
  }
  return planets;
}

function logMessage(text) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = text;
  logEl.prepend(entry);
  while (logEl.children.length > 12) {
    logEl.removeChild(logEl.lastChild);
  }
}

state.planets = generatePlanets();
renderInventory();
renderMarket();
logMessage('System boot complete. Vector drift stable.');

function applyMarketTick() {
  for (const item of marketCatalog) {
    const current = state.market[item.key];
    const wave = Math.sin(state.time * 0.9 + item.base) * 1.4;
    current.price = Math.max(5, item.base + wave + current.trend * 0.9);
    current.volume = 30 + Math.abs(Math.cos(state.time * 0.8 + item.base)) * 120;
  }
  renderMarket();
}

function renderInventory() {
  inventoryEl.innerHTML = '';
  for (const key of Object.keys(state.player.cargo)) {
    const value = state.player.cargo[key];
    if (value <= 0) continue;
    const row = document.createElement('div');
    row.className = 'inventory-row';
    row.innerHTML = `<span>${key}</span><strong>${value}</strong>`;
    inventoryEl.appendChild(row);
  }
  if (!inventoryEl.children.length) {
    inventoryEl.innerHTML = '<div class="inventory-row"><span>Empty</span><strong>0</strong></div>';
  }
  creditsEl.textContent = Math.round(state.player.credits).toString();
  fuelEl.textContent = Math.max(0, state.player.fuel).toFixed(0);
  sectorEl.textContent = state.sector;
}

function renderMarket() {
  marketEl.innerHTML = '';
  for (const item of marketCatalog) {
    const current = state.market[item.key];
    const row = document.createElement('div');
    row.className = 'market-row';
    row.innerHTML = `
      <div>
        <div>${item.name}</div>
        <small>${current.price.toFixed(2)} cr / unit</small>
      </div>
      <div style="display:flex; gap:6px;">
        <button data-buy="${item.key}" aria-label="Buy ${item.name}">Buy</button>
        <button class="sell" data-sell="${item.key}" aria-label="Sell ${item.name}">Sell</button>
      </div>
    `;
    marketEl.appendChild(row);
  }

  marketEl.querySelectorAll('button[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      buyCommodity(button.dataset.buy);
    });
  });

  marketEl.querySelectorAll('button[data-sell]').forEach((button) => {
    button.addEventListener('click', () => {
      sellCommodity(button.dataset.sell);
    });
  });
}

function buyCommodity(key) {
  const price = state.market[key].price;
  const cost = price * 3;
  if (state.player.credits < cost) {
    logMessage(`Insufficient credits for ${key}.`);
    return;
  }
  state.player.credits -= cost;
  state.player.cargo[key] += 3;
  logMessage(`Purchased 3 units of ${key}.`);
  renderInventory();
}

function sellCommodity(key) {
  if (state.player.cargo[key] <= 0) {
    logMessage(`No ${key} cargo to sell.`);
    return;
  }
  const price = state.market[key].price;
  state.player.cargo[key] -= 1;
  state.player.credits += price;
  logMessage(`Sold 1 ${key} for ${price.toFixed(2)} credits.`);
  renderInventory();
}

function nearestPlanet() {
  let best = null;
  let bestDistance = Infinity;
  for (const planet of state.planets) {
    const dx = planet.x - state.player.x;
    const dy = planet.y - state.player.y;
    const d = Math.hypot(dx, dy);
    if (d < bestDistance) {
      bestDistance = d;
      best = planet;
    }
  }
  return { planet: best, distance: bestDistance };
}

function mineResource() {
  const data = nearestPlanet();
  if (!data.planet) return;
  const range = data.distance - data.planet.radius;
  if (range > 34) {
    logMessage('Mining target out of range.');
    return;
  }
  const key = data.planet.resource;
  state.player.cargo[key] += 1 + Math.floor(Math.random() * 2);
  state.player.credits += 8;
  logMessage(`Harvested ${key} from ${data.planet.id + 1}.`);
  renderInventory();
}

function update(delta) {
  state.time += delta;
  const moveX = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
  const moveY = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
  const boost = keys['shift'] ? 2.2 : 1;
  const thrust = 120 * boost;
  state.player.vx += (moveX * thrust) * delta;
  state.player.vy += (moveY * thrust) * delta;
  state.player.vx *= 0.96;
  state.player.vy *= 0.96;
  state.player.x += state.player.vx * delta;
  state.player.y += state.player.vy * delta;

  if (state.player.x > 700) state.player.x = -700;
  if (state.player.x < -700) state.player.x = 700;
  if (state.player.y > 420) state.player.y = -420;
  if (state.player.y < -420) state.player.y = 420;

  if (state.player.fuel > 0 && (moveX || moveY)) {
    state.player.fuel -= (0.8 + (keys['shift'] ? 1.4 : 0)) * delta;
  }

  if (state.player.fuel <= 0) {
    state.player.fuel = 0;
    state.player.vx *= 0.7;
    state.player.vy *= 0.7;
  }

  applyMarketTick();
  const nearest = nearestPlanet();
  targetEl.textContent = nearest.planet ? `P${nearest.planet.id + 1} (${nearest.distance.toFixed(0)}m)` : 'None';
}

function drawBackground() {
  ctx.fillStyle = '#050d17';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const star of state.starfield) {
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  for (const planet of state.planets) {
    const drawX = centerX + planet.x - state.player.x * 0.55;
    const drawY = centerY + planet.y - state.player.y * 0.55;
    const gradient = ctx.createRadialGradient(drawX, drawY, 4, drawX, drawY, planet.radius + 24);
    gradient.addColorStop(0, planet.color);
    gradient.addColorStop(0.7, '#0d2240');
    gradient.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(drawX, drawY, planet.radius + 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = planet.color;
    ctx.beginPath();
    ctx.arc(drawX, drawY, planet.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(drawX - planet.radius * 0.25, drawY - planet.radius * 0.2, planet.radius * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const px = centerX;
  const py = centerY;
  const angle = Math.atan2(state.player.vy, state.player.vx) || 0;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = '#d8faff';
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -8);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-12, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#7bdff2';
  ctx.fillRect(-16, -2.5, 12, 5);
  ctx.restore();
}

function drawHud() {
  const nearest = nearestPlanet();
  if (!nearest.planet) return;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const drawX = centerX + nearest.planet.x - state.player.x * 0.55;
  const drawY = centerY + nearest.planet.y - state.player.y * 0.55;
  ctx.strokeStyle = 'rgba(123, 223, 242, 0.9)';
  ctx.beginPath();
  ctx.arc(drawX, drawY, nearest.planet.radius + 24, 0, Math.PI * 2);
  ctx.stroke();
}

function render() {
  drawBackground();
  drawHud();
  drawPlayer();
}

let lastFrame = performance.now();
function loop(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.033);
  lastFrame = now;
  update(delta);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

window.addEventListener('pointerdown', () => {
  if (state.player.fuel < 100) {
    state.player.fuel = Math.min(100, state.player.fuel + 10);
    logMessage('Refueling from reserve tank.');
  }
});
