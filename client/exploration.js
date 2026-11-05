import * as THREE from 'three';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#view');
const ui = {
  system: $('#system-name'), velocity: $('#velocity'), target: $('#target'), range: $('#range'),
  hubRange: $('#hub-range'), survey: $('#survey'), notice: $('#notice'), warp: $('#warp'),
  guide: $('#guide-hub'), cargo: $('#cargo'), capacity: $('#cargo-capacity'), credits: $('#credits'),
  trade: $('#trade-panel'), hubTitle: $('#hub-title'), hubDescription: $('#hub-description'),
  hubCargo: $('#hub-cargo'), marketStatus: $('#market-status')
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050b);
// Long draw range is required by the enlarged systems (outer planets can be millions of units away).
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 5, 8_000_000);
const clock = new THREE.Clock();
const SAVE_KEY = 'procedural-space-economy-save-v1';
const CARGO_LIMIT = 40;

function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { cargo: data.cargo && typeof data.cargo === 'object' ? data.cargo : {}, credits: Number.isSafeInteger(data.credits) && data.credits >= 0 ? data.credits : 0,
      scanned: new Set(Array.isArray(data.scanned) ? data.scanned : []), extracted: data.extracted && typeof data.extracted === 'object' ? data.extracted : {} };
  } catch { return { cargo: {}, credits: 0, scanned: new Set(), extracted: {} }; }
}
const save = loadSave();
const state = {
  seed: 0x5eed1234, system: 0, objects: [], planets: [], hub: null, keys: new Set(),
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, ship: new THREE.Group(),
  cargo: save.cargo, credits: save.credits, scanned: save.scanned, extracted: save.extracted,
  mineCooldown: 0, autopilot: false, tradeOpen: false
};

function rng(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(x, y, z, seed) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const plane = (dz) => { const row = (dy) => lerp(hash3(ix, iy + dy, iz + dz, seed), hash3(ix + 1, iy + dy, iz + dz, seed), fx); return lerp(row(0), row(1), fy); };
  return lerp(plane(0), plane(1), fz) * 2 - 1;
}
function fbm(x, y, z, seed) {
  let sum = 0, amplitude = 0.55, frequency = 1, total = 0;
  for (let i = 0; i < 5; i++) { sum += noise(x * frequency, y * frequency, z * frequency, seed + i * 7919) * amplitude; total += amplitude; amplitude *= 0.48; frequency *= 2.03; }
  return sum / total;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cargo: state.cargo, credits: state.credits, scanned: [...state.scanned], extracted: state.extracted })); }
  catch { ui.notice.textContent = 'Could not save: browser storage is unavailable or full.'; }
}
function cargoCount() { return Object.values(state.cargo).reduce((sum, n) => sum + (Number.isSafeInteger(n) && n > 0 ? n : 0), 0); }
function renderCargo(container = ui.cargo) {
  container.replaceChildren();
  const items = Object.keys(state.cargo).filter((key) => Number.isSafeInteger(state.cargo[key]) && state.cargo[key] > 0).sort();
  if (!items.length) { const empty = document.createElement('span'); empty.className = 'muted'; empty.textContent = 'Empty'; container.append(empty); }
  for (const item of items) { const row = document.createElement('div'); row.className = 'cargo-row'; const label = document.createElement('span'); label.textContent = item; const amount = document.createElement('strong'); amount.textContent = String(state.cargo[item]); row.append(label, amount); container.append(row); }
  if (container === ui.cargo) { ui.capacity.textContent = `${cargoCount()} / ${CARGO_LIMIT} units`; ui.credits.textContent = `Credits: ${state.credits.toLocaleString()}`; }
}
function add(object) { scene.add(object); state.objects.push(object); return object; }
function clearSystem() {
  for (const object of state.objects) {
    scene.remove(object);
    object.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
  }
  state.objects = []; state.planets = []; state.hub = null;
}
function makePlanetGeometry(radius, seed, amplitude) {
  const geometry = new THREE.SphereGeometry(radius, 128, 96);
  const positions = geometry.attributes.position;
  const direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const warp = fbm(direction.x * 2.2 + 8, direction.y * 2.2, direction.z * 2.2, seed ^ 0x32a1);
    const continents = fbm(direction.x * 2.8 + warp * 0.3, direction.y * 2.8, direction.z * 2.8, seed);
    const ridges = 1 - Math.abs(fbm(direction.x * 5, direction.y * 5, direction.z * 5, seed ^ 0x771));
    const h = amplitude * (continents * 0.76 + (ridges - 0.5) * 0.28);
    positions.setXYZ(i, direction.x * (radius + h), direction.y * (radius + h), direction.z * (radius + h));
  }
  geometry.computeVertexNormals();
  return geometry;
}
function makeHub(seed, scale, styleIndex) {
  const random = rng(seed ^ 0x71ade), group = new THREE.Group();
  const palette = [[0x42d9d0, 0x174d60, 0xffc857], [0xff8066, 0x57334b, 0xffd18a], [0x9c8cff, 0x342d65, 0x65e5ff], [0xa6e86f, 0x385535, 0xffaa55]][styleIndex];
  const names = ['Helix Exchange', 'Wayfarer Anchorage', 'Lumen Freeport', 'Frontier Spindle'];
  const styles = ['Ring habitat', 'Twin-ring bazaar', 'Spindle exchange', 'Radial cargo lattice'];
  const metal = new THREE.MeshStandardMaterial({ color: palette[1], metalness: 0.66, roughness: 0.42 });
  const trim = new THREE.MeshStandardMaterial({ color: palette[0], metalness: 0.72, roughness: 0.28, emissive: palette[0], emissiveIntensity: 0.13 });
  const lamps = new THREE.MeshBasicMaterial({ color: palette[2] });
  const put = (geometry, material, position) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); group.add(mesh); return mesh; };
  const core = put(new THREE.CylinderGeometry(scale * 0.2, scale * 0.3, scale, 12), metal, new THREE.Vector3()); core.rotation.z = Math.PI / 2;
  const rings = styleIndex === 1 ? 2 : 1;
  for (let r = 0; r < rings; r++) {
    const radius = scale * (0.85 + r * 0.36);
    const ring = put(new THREE.TorusGeometry(radius, scale * 0.07, 10, 64), trim, new THREE.Vector3(0, r * scale * 0.2, 0)); ring.rotation.x = Math.PI / 2 + r * 0.2;
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5 + r * 0.1, p = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const module = put(new THREE.BoxGeometry(scale * 0.22, scale * 0.15, scale * 0.28), i % 3 ? metal : trim, p); module.rotation.y = -angle;
      put(new THREE.BoxGeometry(scale * 0.08, scale * 0.07, scale * 0.08), lamps, p.clone().multiplyScalar(1.05).add(new THREE.Vector3(0, scale * 0.12, 0)));
      if (styleIndex === 2) { const spoke = put(new THREE.BoxGeometry(scale * 0.04, scale * 0.04, radius), trim, new THREE.Vector3()); spoke.rotation.y = angle; }
    }
  }
  group.add(new THREE.PointLight(palette[2], scale * 4, scale * 12));
  group.userData = { name: names[styleIndex], style: styles[styleIndex], scale };
  return group;
}
function generateSystem() {
  clearSystem();
  if (state.tradeOpen) closeTrade();
  const systemSeed = (state.seed + Math.imul(state.system, 0x9e3779b9)) >>> 0, random = rng(systemSeed);
  const starColor = new THREE.Color().setHSL(0.035 + random() * 0.16, 0.9, 0.63);
  // 100,000–150,000 scene-unit radius: the sun is a destination, not a dot.
  const starRadius = 100_000 + random() * 50_000;
  add(new THREE.Mesh(new THREE.SphereGeometry(starRadius, 64, 48), new THREE.MeshBasicMaterial({ color: starColor })));
  add(new THREE.Mesh(new THREE.SphereGeometry(starRadius * 1.12, 48, 32), new THREE.MeshBasicMaterial({ color: starColor, transparent: true, opacity: 0.11, side: THREE.BackSide, depthWrite: false })));
  add(new THREE.PointLight(starColor, 250_000_000, 3_000_000, 1.2));
  add(new THREE.AmbientLight(0x7188aa, 0.65));

  const count = 5 + Math.floor(random() * 3);
  const colors = [0x397ec1, 0xb48461, 0x82a981, 0x7d70aa, 0xb7a66f, 0x598d91, 0xa14f55];
  let orbit = starRadius * 2.7;
  for (let i = 0; i < count; i++) {
    orbit += starRadius * (1.7 + random() * 1.3);
    // 50,000–100,000 units in radius. Terrain displacement scales with the body.
    const radius = 50_000 + random() * 50_000;
    const planetSeed = Math.floor(random() * 0xffffffff) >>> 0;
    const color = colors[Math.floor(random() * colors.length)];
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.015 });
    const mesh = new THREE.Mesh(makePlanetGeometry(radius, planetSeed, radius * (0.025 + random() * 0.055)), material);
    const angle = random() * Math.PI * 2, inclination = (random() - 0.5) * orbit * 0.025;
    mesh.position.set(Math.cos(angle) * orbit, inclination, Math.sin(angle) * orbit);
    add(mesh);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.025, 40, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.075, side: THREE.BackSide, depthWrite: false }));
    mesh.add(atmosphere);
    const orbitLine = new THREE.Mesh(new THREE.TorusGeometry(orbit, Math.max(100, radius * 0.003), 5, 200), new THREE.MeshBasicMaterial({ color: 0x59748e, transparent: true, opacity: 0.19 }));
    orbitLine.rotation.x = Math.PI / 2; add(orbitLine);
    state.planets.push({ mesh, radius, seed: planetSeed, resource: ['iron', 'silicate', 'crystal', 'volatiles'][i % 4], orbit, deposit: 12 + planetSeed % 25 });
  }

  const hubSeed = (systemSeed ^ 0x6d2b79f5) >>> 0, hubScale = 15_000 + hubSeed % 11_000, styleIndex = (hubSeed >>> 8) % 4;
  const hubOrbit = orbit + starRadius * 3, hubAngle = random() * Math.PI * 2;
  const hub = makeHub(hubSeed, hubScale, styleIndex);
  hub.position.set(Math.cos(hubAngle) * hubOrbit, (random() - 0.5) * starRadius, Math.sin(hubAngle) * hubOrbit);
  add(hub); state.hub = hub;

  const points = new Float32Array(2600 * 3), stars = rng(systemSeed ^ 0xdeadbeef);
  for (let i = 0; i < 2600; i++) { const v = new THREE.Vector3(stars() * 2 - 1, stars() * 2 - 1, stars() * 2 - 1).normalize().multiplyScalar(1_500_000 + stars() * 3_500_000); points.set([v.x, v.y, v.z], i * 3); }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xa9d9ff, size: 360, sizeAttenuation: true, transparent: true, opacity: 0.9 })));

  ui.system.textContent = `SECTOR ${state.system + 1} · ${systemSeed.toString(16).toUpperCase().padStart(8, '0')}`;
  // Spawn just above the first world and look toward it so the scale is immediately obvious.
  state.position.copy(state.planets[0].mesh.position).add(new THREE.Vector3(0, 0, state.planets[0].radius * 1.28));
  state.velocity.set(0, 0, 0); state.yaw = 0; state.pitch = -0.18; state.autopilot = false;
  ui.guide.textContent = 'Guide to trade hub'; ui.survey.textContent = 'Approach a planet and press E to survey.';
  ui.notice.textContent = `Colossal worlds: planet radius ${(state.planets[0].radius / 1000).toFixed(0)}k units; star radius ${(starRadius / 1000).toFixed(0)}k units. Fly forward to approach.`;
}
function makeShip() {
  const hull = new THREE.Mesh(new THREE.ConeGeometry(1100, 4200, 6), new THREE.MeshStandardMaterial({ color: 0xbbefff, metalness: 0.7, roughness: 0.3, emissive: 0x103044 }));
  hull.rotation.x = Math.PI / 2; state.ship.add(hull);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(6200, 240, 1500), new THREE.MeshStandardMaterial({ color: 0x338cb0, metalness: 0.6, roughness: 0.34 }));
  wings.position.z = 750; state.ship.add(wings);
  const engine = new THREE.PointLight(0x40bfff, 1800, 16000); engine.position.z = 2400; state.ship.add(engine);
  scene.add(state.ship);
}
function forward() { return new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch)).normalize(); }
function fly(dt) {
  const fwd = forward(), right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const direction = new THREE.Vector3();
  if (state.autopilot && state.hub) {
    const toHub = state.hub.position.clone().sub(state.position);
    if (toHub.length() > state.hub.userData.scale * 3) { const desired = toHub.normalize(); state.yaw = Math.atan2(-desired.x, -desired.z); state.pitch = Math.asin(THREE.MathUtils.clamp(desired.y, -1, 1)); direction.addScaledVector(desired, 0.75); }
    else { state.autopilot = false; ui.notice.textContent = 'Trade hub reached. Press T to dock.'; }
  }
  if (state.keys.has('w')) direction.add(fwd); if (state.keys.has('s')) direction.sub(fwd);
  if (state.keys.has('d')) direction.add(right); if (state.keys.has('a')) direction.sub(right);
  if (state.keys.has('r')) direction.add(up); if (state.keys.has('control')) direction.sub(up);
  if (direction.lengthSq()) state.velocity.addScaledVector(direction.normalize(), (state.keys.has('shift') ? 420_000 : 110_000) * dt);
  state.velocity.multiplyScalar(Math.pow(state.keys.has(' ') ? 0.08 : 0.996, dt * 60));
  if (state.velocity.length() > 900_000) state.velocity.setLength(900_000);
  state.position.addScaledVector(state.velocity, dt);
  state.ship.position.copy(state.position); state.ship.rotation.order = 'YXZ'; state.ship.rotation.y = state.yaw; state.ship.rotation.x = -state.pitch;
  const offset = new THREE.Vector3(0, 6200, 18000).applyEuler(state.ship.rotation);
  camera.position.copy(state.position).add(offset); camera.lookAt(state.position.clone().addScaledVector(fwd, 70_000));
  state.mineCooldown = Math.max(0, state.mineCooldown - dt);
  if (state.hub) state.hub.rotation.y += dt * 0.018;
}
function nearestPlanet() {
  let best = null, range = Infinity;
  for (const planet of state.planets) { const d = state.position.distanceTo(planet.mesh.position) - planet.radius; if (d < range) { best = planet; range = d; } }
  return { planet: best, range };
}
function hubRange() { return state.hub ? state.position.distanceTo(state.hub.position) - state.hub.userData.scale * 1.5 : Infinity; }
function updateHud() {
  const { planet, range } = nearestPlanet();
  ui.target.textContent = planet ? `${planet.resource.toUpperCase()} WORLD` : 'None';
  ui.range.textContent = planet ? `${Math.max(0, range).toFixed(0)} u` : '—';
  ui.hubRange.textContent = state.hub ? `${Math.max(0, hubRange()).toFixed(0)} u${hubRange() <= state.hub.userData.scale * 2.5 ? ' · DOCK [T]' : ''}` : '—';
  ui.velocity.textContent = `${state.velocity.length().toFixed(0)} u/s`;
}
function survey() {
  const { planet, range } = nearestPlanet();
  if (!planet || range > planet.radius * 0.45) { ui.notice.textContent = 'Move closer to a planet to survey its surface.'; return; }
  const key = `${state.system}:${planet.seed}`, first = !state.scanned.has(key); state.scanned.add(key);
  const remaining = Math.max(0, planet.deposit - (state.extracted[key] || 0));
  ui.survey.textContent = `${planet.resource.toUpperCase()} · radius ${(planet.radius / 1000).toFixed(0)}k u · deposit ${remaining} · ${first ? 'new discovery' : 'surveyed'}`;
  if (first) persist(); ui.notice.textContent = 'Survey complete. Press M near the surface to mine.';
}
function mine() {
  if (state.mineCooldown > 0) return;
  const { planet, range } = nearestPlanet();
  if (!planet || range > planet.radius * 0.12) { ui.notice.textContent = 'Mining range exceeded. Approach much closer to the planet surface.'; return; }
  if (cargoCount() >= CARGO_LIMIT) { ui.notice.textContent = 'Cargo hold full. Visit a trade hub to inspect the regional market.'; return; }
  const key = `${state.system}:${planet.seed}`, extracted = state.extracted[key] || 0;
  if (extracted >= planet.deposit) { ui.notice.textContent = `The ${planet.resource} deposit is depleted.`; return; }
  state.extracted[key] = extracted + 1; state.cargo[planet.resource] = (state.cargo[planet.resource] || 0) + 1;
  state.mineCooldown = 0.65; persist(); renderCargo();
  ui.notice.textContent = `Mined one ${planet.resource}; ${planet.deposit - extracted - 1} deposit units remain.`;
}
function openTrade() {
  if (!state.hub || hubRange() > state.hub.userData.scale * 2.5) { ui.notice.textContent = 'Too far to dock. Use Guide to trade hub.'; return; }
  state.tradeOpen = true; state.autopilot = false;
  ui.hubTitle.textContent = state.hub.userData.name; ui.hubDescription.textContent = `${state.hub.userData.style} · Sector ${state.system + 1}`;
  renderCargo(ui.hubCargo);
  ui.marketStatus.textContent = 'This player-driven order book is empty unless players create buy orders and sell offers. No stock or transactions are seeded.';
  ui.trade.hidden = false; document.exitPointerLock?.();
}
function closeTrade() { state.tradeOpen = false; ui.trade.hidden = true; }
function jump() { if (state.tradeOpen) closeTrade(); state.system++; generateSystem(); }

makeShip(); generateSystem(); renderCargo();
canvas.addEventListener('click', () => { if (!state.tradeOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { if (!state.tradeOpen) ui.notice.textContent = document.pointerLockElement === canvas ? 'Flight controls active. Explore the colossal system.' : 'Click the scene to capture the mouse and fly.'; });
document.addEventListener('mousemove', (event) => { if (document.pointerLockElement !== canvas || state.tradeOpen) return; state.yaw -= event.movementX * 0.002; state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.002, -1.45, 1.45); });
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (state.tradeOpen) { if (key === 'escape' || key === 't') closeTrade(); return; }
  state.keys.add(key); if ([' ', 'arrowup', 'arrowdown'].includes(key)) event.preventDefault();
  if (key === 'e' && !event.repeat) survey(); if (key === 'm' && !event.repeat) mine();
  if (key === 'j' && !event.repeat) jump(); if (key === 't' && !event.repeat) openTrade();
});
document.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());
ui.warp.addEventListener('click', jump);
ui.guide.addEventListener('click', () => { state.autopilot = !state.autopilot; ui.guide.textContent = state.autopilot ? 'Cancel hub guide' : 'Guide to trade hub'; ui.notice.textContent = state.autopilot ? 'Autopilot guiding to this system’s trade hub.' : 'Hub guidance cancelled.'; });
$('#close-trade').addEventListener('click', closeTrade);
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6)); });
function frame() { requestAnimationFrame(frame); if (!state.tradeOpen) { fly(Math.min(clock.getDelta(), 0.05)); updateHud(); } renderer.render(scene, camera); }
frame();
