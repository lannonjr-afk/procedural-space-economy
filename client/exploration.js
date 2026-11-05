import * as THREE from 'three';

const canvas = document.querySelector('#view');
const ui = {
  system: document.querySelector('#system-name'), velocity: document.querySelector('#velocity'),
  position: document.querySelector('#position'), target: document.querySelector('#target'),
  range: document.querySelector('#range'), survey: document.querySelector('#survey'),
  notice: document.querySelector('#notice'), warp: document.querySelector('#warp'), guide: document.querySelector('#guide-hub'),
  hubRange: document.querySelector('#hub-range'), cargo: document.querySelector('#cargo'), capacity: document.querySelector('#cargo-capacity'),
  credits: document.querySelector('#credits'), trade: document.querySelector('#trade-panel'), hubTitle: document.querySelector('#hub-title'),
  hubDescription: document.querySelector('#hub-description'), hubCargo: document.querySelector('#hub-cargo'),
  marketStatus: document.querySelector('#market-status')
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030912);
scene.fog = new THREE.FogExp2(0x030912, 0.00012);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 30000);
const clock = new THREE.Clock();
const CARGO_LIMIT = 40;
const SAVE_KEY = 'procedural-space-economy-save-v1';

function loadSave() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { cargo: value.cargo && typeof value.cargo === 'object' ? value.cargo : {},
      credits: Number.isSafeInteger(value.credits) && value.credits >= 0 ? value.credits : 0,
      scanned: Array.isArray(value.scanned) ? value.scanned.filter((x) => typeof x === 'string') : [],
      extracted: value.extracted && typeof value.extracted === 'object' ? value.extracted : {} };
  } catch { return { cargo: {}, credits: 0, scanned: [], extracted: {} }; }
}
const save = loadSave();
const state = {
  systemSeed: 0x5eed1234, systemIndex: 0, planets: [], objects: [], keys: new Set(),
  yaw: 0, pitch: 0, velocity: new THREE.Vector3(), position: new THREE.Vector3(0, 0, 220),
  ship: new THREE.Group(), target: null, scanned: new Set(save.scanned), cargo: save.cargo,
  credits: save.credits, extracted: save.extracted, mineCooldown: 0, hub: null, autopilot: false, tradeOpen: false
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
function valueNoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const plane = (dz) => { const row = (dy) => lerp(hash3(ix, iy + dy, iz + dz, seed), hash3(ix + 1, iy + dy, iz + dz, seed), fx); return lerp(row(0), row(1), fy); };
  return lerp(plane(0), plane(1), fz) * 2 - 1;
}
function fbm(x, y, z, seed) {
  let sum = 0, amp = 0.55, freq = 1, norm = 0;
  for (let octave = 0; octave < 5; octave++) { sum += valueNoise(x * freq, y * freq, z * freq, seed + octave * 7919) * amp; norm += amp; amp *= 0.48; freq *= 2.03; }
  return sum / norm;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cargo: state.cargo, credits: state.credits, scanned: [...state.scanned], extracted: state.extracted })); }
  catch { ui.notice.textContent = 'Save unavailable: browser storage is full or disabled.'; }
}
function cargoCount() { return Object.values(state.cargo).reduce((sum, amount) => sum + (Number.isSafeInteger(amount) && amount > 0 ? amount : 0), 0); }
function cargoRows(container) {
  container.replaceChildren();
  const names = Object.keys(state.cargo).filter((key) => Number.isSafeInteger(state.cargo[key]) && state.cargo[key] > 0).sort();
  if (!names.length) { const empty = document.createElement('span'); empty.className = 'muted'; empty.textContent = 'Empty'; container.append(empty); }
  for (const name of names) { const row = document.createElement('div'); row.className = 'cargo-row'; const label = document.createElement('span'); label.textContent = name; const count = document.createElement('strong'); count.textContent = String(state.cargo[name]); row.append(label, count); container.append(row); }
}
function renderCargo() {
  cargoRows(ui.cargo); ui.capacity.textContent = `${cargoCount()} / ${CARGO_LIMIT} units`;
  ui.credits.textContent = `Credits: ${state.credits.toLocaleString()}`;
  if (state.tradeOpen) cargoRows(ui.hubCargo);
}
function clearSystem() {
  for (const object of state.objects) { scene.remove(object); object.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); }); }
  state.objects = []; state.planets = []; state.hub = null;
}
function addObject(object) { scene.add(object); state.objects.push(object); return object; }
function planetSurface(radius, seed, amplitude) {
  const geometry = new THREE.SphereGeometry(radius, 96, 64), positions = geometry.attributes.position, direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const warp = fbm(direction.x * 2.4 + 8, direction.y * 2.4, direction.z * 2.4, seed ^ 0x32a1);
    const detail = fbm(direction.x * 3.2 + warp * 0.22, direction.y * 3.2, direction.z * 3.2, seed);
    const ridge = 1 - Math.abs(fbm(direction.x * 5, direction.y * 5, direction.z * 5, seed ^ 0x771));
    const height = amplitude * (detail * 0.72 + (ridge - 0.5) * 0.34);
    positions.setXYZ(i, direction.x * (radius + height), direction.y * (radius + height), direction.z * (radius + height));
  }
  geometry.computeVertexNormals(); return geometry;
}
function makeTradeHub(seed, scale, paletteIndex) {
  const random = rng(seed ^ 0x71ade), group = new THREE.Group();
  const palettes = [ [0x42d9d0, 0x174d60, 0xffc857], [0xff8066, 0x57334b, 0xffd18a], [0x9c8cff, 0x342d65, 0x65e5ff], [0xa6e86f, 0x385535, 0xffaa55] ];
  const names = ['Helix Exchange', 'Wayfarer Anchorage', 'Lumen Freeport', 'Frontier Spindle'];
  const styles = ['Ring habitat', 'Twin-ring bazaar', 'Spindle exchange', 'Radial cargo lattice'];
  const palette = palettes[paletteIndex % palettes.length], trim = new THREE.MeshStandardMaterial({ color: palette[0], metalness: 0.72, roughness: 0.3, emissive: palette[0], emissiveIntensity: 0.16 });
  const hull = new THREE.MeshStandardMaterial({ color: palette[1], metalness: 0.62, roughness: 0.46 });
  const light = new THREE.MeshBasicMaterial({ color: palette[2] });
  const add = (geometry, material, position, rotation = null) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z); group.add(mesh); return mesh; };
  const barBetween = (a, b, radius, material) => { const delta = new THREE.Vector3().subVectors(b, a); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material); mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); group.add(mesh); };
  const core = add(new THREE.CylinderGeometry(scale * 0.22, scale * 0.34, scale * 1.35, 12), hull, new THREE.Vector3()); core.rotation.z = Math.PI / 2;
  add(new THREE.SphereGeometry(scale * 0.31, 20, 16), trim, new THREE.Vector3());
  const ringCount = paletteIndex === 1 ? 2 : 1;
  for (let r = 0; r < ringCount; r++) {
    const ringRadius = scale * (0.82 + r * 0.32);
    const ring = add(new THREE.TorusGeometry(ringRadius, scale * (r ? 0.045 : 0.075), 10, 64), trim, new THREE.Vector3(0, r * scale * 0.16, 0));
    ring.rotation.x = Math.PI / 2 + r * 0.25;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 + r * 0.12;
      const outer = new THREE.Vector3(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      if (paletteIndex === 2) barBetween(new THREE.Vector3(0, 0, 0), outer, scale * 0.035, hull);
      const module = add(new THREE.BoxGeometry(scale * (0.19 + random() * 0.11), scale * 0.16, scale * 0.27), i % 3 === 0 ? trim : hull, outer);
      module.rotation.y = -angle;
      const beacon = add(new THREE.BoxGeometry(scale * 0.08, scale * 0.08, scale * 0.09), light,
        outer.clone().multiplyScalar(1.05).add(new THREE.Vector3(0, scale * 0.11, 0)));
      beacon.rotation.y = -angle;
    }
  }
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + random() * 0.18;
    const inner = new THREE.Vector3(Math.cos(angle) * scale * 0.3, 0, Math.sin(angle) * scale * 0.3);
    const outer = new THREE.Vector3(Math.cos(angle) * scale * 1.55, 0, Math.sin(angle) * scale * 1.55);
    barBetween(inner, outer, scale * 0.045, hull);
    const pad = add(new THREE.BoxGeometry(scale * 0.38, scale * 0.08, scale * 0.24), trim, outer);
    pad.rotation.y = -angle;
  }
  const beacon = new THREE.PointLight(palette[2], scale * 3, scale * 10);
  group.add(beacon);
  group.userData = { name: names[paletteIndex % names.length], style: styles[paletteIndex % styles.length], scale };
  return group;
}
function generateSystem() {
  clearSystem();
  if (state.tradeOpen) closeTrade();
  const seed = (state.systemSeed + Math.imul(state.systemIndex, 0x9e3779b9)) >>> 0, random = rng(seed);
  const starHue = 0.04 + random() * 0.17, starColor = new THREE.Color().setHSL(starHue, 0.88, 0.65);
  const starRadius = 72 + random() * 52;
  const star = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 48, 36), new THREE.MeshBasicMaterial({ color: starColor }));
  addObject(star);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(starRadius * 1.13, 36, 24), new THREE.MeshBasicMaterial({ color: starColor, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }));
  addObject(corona);
  addObject(new THREE.PointLight(starColor, 13000, 12000, 1.2));
  addObject(new THREE.AmbientLight(0x6985a5, 0.62));
  const count = 4 + Math.floor(random() * 4), colors = [0x4b8cbf, 0xb48461, 0x82a981, 0x7d70aa, 0xb7a66f, 0x598d91];
  let orbit = 430;
  for (let i = 0; i < count; i++) {
    orbit += 260 + random() * 330;
    const radius = 32 + random() * (i < 2 ? 38 : 82), planetSeed = Math.floor(random() * 0xffffffff) >>> 0;
    const material = new THREE.MeshStandardMaterial({ color: colors[Math.floor(random() * colors.length)], roughness: 0.92, metalness: 0.02 });
    const mesh = new THREE.Mesh(planetSurface(radius, planetSeed, radius * (0.035 + random() * 0.09)), material);
    const angle = random() * Math.PI * 2, inclination = (random() - 0.5) * 0.38;
    mesh.position.set(Math.cos(angle) * orbit, Math.sin(inclination) * orbit, Math.sin(angle) * orbit); addObject(mesh);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 32, 20), new THREE.MeshBasicMaterial({ color: material.color, transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false })); mesh.add(glow);
    const orbitLine = new THREE.Mesh(new THREE.TorusGeometry(orbit, 0.65, 4, 180), new THREE.MeshBasicMaterial({ color: 0x45617a, transparent: true, opacity: 0.28 })); orbitLine.rotation.x = Math.PI / 2; addObject(orbitLine);
    state.planets.push({ mesh, radius, seed: planetSeed, resource: ['iron', 'silicate', 'crystal', 'volatiles'][i % 4], orbit, deposit: 12 + (planetSeed % 25) });
  }
  const hubSeed = (seed ^ 0x6d2b79f5) >>> 0, hubScale = 48 + (hubSeed % 36), paletteIndex = (hubSeed >>> 8) % 4;
  const hubOrbit = orbit + 820 + (hubSeed % 420), hubAngle = random() * Math.PI * 2;
  const hub = makeTradeHub(hubSeed, hubScale, paletteIndex);
  hub.position.set(Math.cos(hubAngle) * hubOrbit, (random() - 0.5) * 180, Math.sin(hubAngle) * hubOrbit);
  hub.rotation.set(random() * 0.35, random() * Math.PI * 2, random() * 0.35);
  addObject(hub);
  const hubOrbitLine = new THREE.Mesh(new THREE.TorusGeometry(hubOrbit, 0.8, 4, 180), new THREE.MeshBasicMaterial({ color: 0x53cbea, transparent: true, opacity: 0.13 }));
  hubOrbitLine.rotation.x = Math.PI / 2; addObject(hubOrbitLine);
  const starPositions = new Float32Array(2600 * 3), starRandom = rng(seed ^ 0xdeadbeef);
  for (let i = 0; i < 2600; i++) { const v = new THREE.Vector3(starRandom() * 2 - 1, starRandom() * 2 - 1, starRandom() * 2 - 1).normalize().multiplyScalar(4000 + starRandom() * 11000); starPositions.set([v.x, v.y, v.z], i * 3); }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  addObject(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xa9d9ff, size: 5, sizeAttenuation: true, transparent: true, opacity: 0.85 })));
  state.hub = hub;
  ui.system.textContent = `SECTOR ${state.systemIndex + 1} · ${seed.toString(16).toUpperCase().padStart(8, '0')}`;
  state.target = null; state.position.set(0, 0, starRadius * 2.5); state.velocity.set(0, 0, 0); state.yaw = 0; state.pitch = 0; state.autopilot = false;
  ui.guide.textContent = 'Guide to trade hub'; ui.survey.textContent = 'Approach a planet and press E to scan it.';
  ui.notice.textContent = `Generated ${count} large planets and ${hub.userData.name}, a ${hub.userData.style}. Use the guide button to find the station.`;
}
function makeShip() {
  const hull = new THREE.Mesh(new THREE.ConeGeometry(3.2, 12, 5), new THREE.MeshStandardMaterial({ color: 0xbbefff, metalness: 0.72, roughness: 0.28, emissive: 0x103044 })); hull.rotation.x = Math.PI / 2; state.ship.add(hull);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.55, 3), new THREE.MeshStandardMaterial({ color: 0x338cb0, metalness: 0.6, roughness: 0.35 })); wing.position.z = 2; state.ship.add(wing);
  const engine = new THREE.PointLight(0x40bfff, 14, 65); engine.position.z = 7; state.ship.add(engine); scene.add(state.ship);
}
function getForward() { return new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch)).normalize(); }
function fly(delta) {
  const forward = getForward(), right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw)).normalize(), up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const thrust = state.keys.has('shift') ? 1800 : 460, direction = new THREE.Vector3();
  if (state.autopilot && state.hub) {
    const toHub = state.hub.position.clone().sub(state.position);
    if (toHub.length() > 150) { const desired = toHub.normalize(); state.yaw = Math.atan2(-desired.x, -desired.z); state.pitch = Math.asin(THREE.MathUtils.clamp(desired.y, -1, 1)); direction.addScaledVector(desired, 0.68); }
    else { state.autopilot = false; ui.guide.textContent = 'Guide to trade hub'; ui.notice.textContent = 'Trade hub reached. Press T to dock.'; }
  }
  if (state.keys.has('w')) direction.add(forward); if (state.keys.has('s')) direction.sub(forward);
  if (state.keys.has('d')) direction.add(right); if (state.keys.has('a')) direction.sub(right);
  if (state.keys.has('r')) direction.add(up); if (state.keys.has('control')) direction.sub(up);
  if (direction.lengthSq()) state.velocity.addScaledVector(direction.normalize(), thrust * delta);
  state.velocity.multiplyScalar(Math.pow(state.keys.has(' ') ? 0.12 : 0.997, delta * 60));
  if (state.velocity.length() > 2400) state.velocity.setLength(2400);
  state.position.addScaledVector(state.velocity, delta);
  state.ship.position.copy(state.position); state.ship.rotation.order = 'YXZ'; state.ship.rotation.y = state.yaw; state.ship.rotation.x = -state.pitch;
  const cameraOffset = new THREE.Vector3(0, 18, 48).applyEuler(state.ship.rotation); camera.position.copy(state.position).add(cameraOffset); camera.lookAt(state.position.clone().addScaledVector(forward, 75));
  state.mineCooldown = Math.max(0, state.mineCooldown - delta);
  if (state.hub) state.hub.rotation.y += delta * 0.025;
}
function nearestPlanet() {
  let best = null, bestDistance = Infinity;
  for (const planet of state.planets) { const distance = state.position.distanceTo(planet.mesh.position) - planet.radius; if (distance < bestDistance) { best = planet; bestDistance = distance; } }
  return { planet: best, distance: bestDistance };
}
function hubDistance() { return state.hub ? state.position.distanceTo(state.hub.position) - state.hub.userData.scale * 1.5 : Infinity; }
function updateHud() {
  const { planet, distance } = nearestPlanet(); state.target = planet;
  ui.target.textContent = planet ? `${planet.resource.toUpperCase()} WORLD` : 'None'; ui.range.textContent = planet ? `${Math.max(0, distance).toFixed(0)} u` : '—';
  ui.hubRange.textContent = state.hub ? `${Math.max(0, hubDistance()).toFixed(0)} u${hubDistance() <= state.hub.userData.scale * 2.2 ? ' · DOCK [T]' : ''}` : '—';
  ui.velocity.textContent = `${state.velocity.length().toFixed(0)} u/s`; ui.position.textContent = `${state.position.x.toFixed(0)}, ${state.position.y.toFixed(0)}, ${state.position.z.toFixed(0)}`;
}
function survey() {
  const { planet, distance } = nearestPlanet();
  if (!planet || distance > planet.radius * 1.2) { ui.notice.textContent = 'Survey scan failed: approach to within about one planet radius.'; return; }
  const key = `${state.systemIndex}:${planet.seed}`, first = !state.scanned.has(key); state.scanned.add(key);
  const available = Math.max(0, planet.deposit - (state.extracted[key] || 0)), grade = (0.35 + (planet.seed % 6400) / 10000).toFixed(2);
  ui.survey.textContent = `${planet.resource.toUpperCase()} deposit · grade ${grade} · ${available} units remaining · radius ${planet.radius.toFixed(0)} u · ${first ? 'new discovery logged' : 'surveyed'}.`;
  if (first) persist(); ui.notice.textContent = 'Survey complete. Press M near the surface to mine a unit.';
}
function mine() {
  if (state.mineCooldown > 0) return;
  const { planet, distance } = nearestPlanet();
  if (!planet || distance > planet.radius * 0.65) { ui.notice.textContent = 'Mining range exceeded. Approach the planet surface.'; return; }
  if (cargoCount() >= CARGO_LIMIT) { ui.notice.textContent = 'Cargo hold full. Visit a trade hub; the player bazaar needs other players to create orders.'; return; }
  const key = `${state.systemIndex}:${planet.seed}`, taken = state.extracted[key] || 0;
  if (taken >= planet.deposit) { ui.notice.textContent = `This ${planet.resource} deposit is depleted. Explore another planet or system.`; return; }
  state.extracted[key] = taken + 1; state.cargo[planet.resource] = (state.cargo[planet.resource] || 0) + 1;
  state.mineCooldown = 0.7; persist(); renderCargo();
  ui.notice.textContent = `Mined 1 ${planet.resource}. Deposit: ${planet.deposit - taken - 1} units remaining.`;
  if (ui.survey.textContent.includes('deposit')) ui.survey.textContent = ui.survey.textContent.replace(/\d+ units remaining/, `${planet.deposit - taken - 1} units remaining`);
}
function openTrade() {
  if (!state.hub || hubDistance() > state.hub.userData.scale * 2.2) { ui.notice.textContent = 'Docking range exceeded. Use Guide to trade hub to approach the station.'; return; }
  state.tradeOpen = true; state.autopilot = false; ui.guide.textContent = 'Guide to trade hub';
  ui.hubTitle.textContent = state.hub.userData.name;
  ui.hubDescription.textContent = `${state.hub.userData.style} · Sector ${state.systemIndex + 1}. This regional exchange has no built-in stock.`;
  cargoRows(ui.hubCargo);
  ui.marketStatus.textContent = 'Order book: empty until players place buy orders or sell offers. No system liquidity is seeded.';
  ui.trade.hidden = false; document.exitPointerLock?.();
}
function closeTrade() { state.tradeOpen = false; ui.trade.hidden = true; }
function jumpSystem() {
  if (state.tradeOpen) closeTrade();
  state.systemIndex++; generateSystem();
}

makeShip(); generateSystem(); renderCargo();
canvas.addEventListener('click', () => { if (!state.tradeOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { if (!state.tradeOpen) ui.notice.textContent = document.pointerLockElement === canvas ? 'Flight controls active. Explore, survey, mine, and dock.' : 'Click the scene to capture the mouse and begin flying.'; });
document.addEventListener('mousemove', (event) => { if (document.pointerLockElement !== canvas || state.tradeOpen) return; state.yaw -= event.movementX * 0.0022; state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.0022, -1.45, 1.45); });
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (state.tradeOpen) { if (key === 'escape' || key === 't') closeTrade(); return; }
  state.keys.add(key); if ([' ', 'arrowup', 'arrowdown'].includes(key)) event.preventDefault();
  if (key === 'e' && !event.repeat) survey(); if (key === 'm' && !event.repeat) mine();
  if (key === 'j' && !event.repeat) jumpSystem(); if (key === 't' && !event.repeat) openTrade();
});
document.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase())); window.addEventListener('blur', () => state.keys.clear());
ui.warp.addEventListener('click', jumpSystem);
ui.guide.addEventListener('click', () => { state.autopilot = !state.autopilot; ui.guide.textContent = state.autopilot ? 'Cancel hub guide' : 'Guide to trade hub'; ui.notice.textContent = state.autopilot ? 'Autopilot guiding to this system’s trade hub. Press the button again to cancel.' : 'Hub guidance cancelled.'; });
document.querySelector('#close-trade').addEventListener('click', closeTrade);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); });
function frame() { requestAnimationFrame(frame); if (!state.tradeOpen) { fly(Math.min(clock.getDelta(), 0.05)); updateHud(); } renderer.render(scene, camera); }
frame();
