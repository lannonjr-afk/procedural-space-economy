import * as THREE from 'three';

const canvas = document.querySelector('#view');
const ui = {
  system: document.querySelector('#system-name'), velocity: document.querySelector('#velocity'),
  position: document.querySelector('#position'), target: document.querySelector('#target'),
  range: document.querySelector('#range'), survey: document.querySelector('#survey'),
  notice: document.querySelector('#notice'), warp: document.querySelector('#warp')
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030912);
scene.fog = new THREE.FogExp2(0x030912, 0.00055);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 8000);
const clock = new THREE.Clock();

const state = {
  systemSeed: 0x5eed1234,
  systemIndex: 0,
  planets: [],
  objects: [],
  keys: new Set(),
  yaw: 0,
  pitch: 0,
  velocity: new THREE.Vector3(),
  position: new THREE.Vector3(0, 0, 45),
  ship: new THREE.Group(),
  target: null,
  scanned: new Set()
};

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const plane = (dz) => {
    const row = (dy) => lerp(hash3(ix, iy + dy, iz + dz, seed), hash3(ix + 1, iy + dy, iz + dz, seed), fx);
    return lerp(row(0), row(1), fy);
  };
  return lerp(plane(0), plane(1), fz) * 2 - 1;
}
function fbm(x, y, z, seed) {
  let sum = 0, amp = 0.55, freq = 1, norm = 0;
  for (let octave = 0; octave < 5; octave++) {
    sum += valueNoise(x * freq, y * freq, z * freq, seed + octave * 7919) * amp;
    norm += amp; amp *= 0.48; freq *= 2.03;
  }
  return sum / norm;
}
function clearSystem() {
  for (const object of state.objects) {
    scene.remove(object);
    object.traverse((child) => {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    });
  }
  state.objects = [];
  state.planets = [];
}
function addObject(object) { scene.add(object); state.objects.push(object); return object; }
function planetSurface(radius, seed, amplitude) {
  const geometry = new THREE.SphereGeometry(radius, 96, 64);
  const positions = geometry.attributes.position;
  const direction = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const warp = fbm(direction.x * 2.4 + 8, direction.y * 2.4, direction.z * 2.4, seed ^ 0x32a1);
    const detail = fbm(direction.x * 3.2 + warp * 0.22, direction.y * 3.2, direction.z * 3.2, seed);
    const ridge = 1 - Math.abs(fbm(direction.x * 5, direction.y * 5, direction.z * 5, seed ^ 0x771));
    const height = amplitude * (detail * 0.72 + (ridge - 0.5) * 0.34);
    positions.setXYZ(i, direction.x * (radius + height), direction.y * (radius + height), direction.z * (radius + height));
  }
  geometry.computeVertexNormals();
  return geometry;
}
function generateSystem() {
  clearSystem();
  const seed = (state.systemSeed + Math.imul(state.systemIndex, 0x9e3779b9)) >>> 0;
  const random = rng(seed);
  const starHue = random();
  const starColor = new THREE.Color().setHSL(0.08 + starHue * 0.12, 0.82, 0.67);
  const star = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 24), new THREE.MeshBasicMaterial({ color: starColor }));
  addObject(star);
  const starLight = new THREE.PointLight(starColor, 2600, 1800, 1.35);
  addObject(starLight);
  addObject(new THREE.AmbientLight(0x6985a5, 0.48));
  const count = 4 + Math.floor(random() * 4);
  const colors = [0x4b8cbf, 0xb48461, 0x82a981, 0x7d70aa, 0xb7a66f, 0x598d91];
  let orbit = 70;
  for (let i = 0; i < count; i++) {
    orbit += 55 + random() * 80;
    const radius = 8 + random() * (i < 2 ? 10 : 24);
    const planetSeed = Math.floor(random() * 0xffffffff) >>> 0;
    const material = new THREE.MeshStandardMaterial({ color: colors[Math.floor(random() * colors.length)], roughness: 0.92, metalness: 0.02 });
    const mesh = new THREE.Mesh(planetSurface(radius, planetSeed, radius * (0.025 + random() * 0.08)), material);
    const angle = random() * Math.PI * 2;
    const inclination = (random() - 0.5) * 0.38;
    mesh.position.set(Math.cos(angle) * orbit, Math.sin(inclination) * orbit, Math.sin(angle) * orbit);
    addObject(mesh);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 32, 20), new THREE.MeshBasicMaterial({ color: material.color, transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false }));
    mesh.add(glow);
    const orbitLine = new THREE.Mesh(new THREE.TorusGeometry(orbit, 0.12, 4, 180), new THREE.MeshBasicMaterial({ color: 0x45617a, transparent: true, opacity: 0.28 }));
    orbitLine.rotation.x = Math.PI / 2;
    addObject(orbitLine);
    state.planets.push({ mesh, radius, seed: planetSeed, resource: ['iron', 'silicate', 'crystal', 'volatiles'][i % 4], orbit });
  }
  const starCount = 2200;
  const starPositions = new Float32Array(starCount * 3);
  const starRandom = rng(seed ^ 0xdeadbeef);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3(starRandom() * 2 - 1, starRandom() * 2 - 1, starRandom() * 2 - 1).normalize().multiplyScalar(1200 + starRandom() * 5200);
    starPositions.set([v.x, v.y, v.z], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  addObject(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xa9d9ff, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0.85 })));
  ui.system.textContent = `SECTOR ${state.systemIndex + 1} · ${seed.toString(16).toUpperCase().padStart(8, '0')}`;
  state.target = null;
  state.scanned.clear();
  state.position.set(0, 0, 45);
  state.velocity.set(0, 0, 0);
  ui.survey.textContent = 'Approach a planet and press E to scan it.';
  ui.notice.textContent = `Entered a newly generated system with ${count} planets. Fly close to survey.`;
}
function makeShip() {
  const hull = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5.2, 5), new THREE.MeshStandardMaterial({ color: 0xbbefff, metalness: 0.72, roughness: 0.28, emissive: 0x103044 }));
  hull.rotation.x = Math.PI / 2;
  state.ship.add(hull);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.18, 1.1), new THREE.MeshStandardMaterial({ color: 0x338cb0, metalness: 0.6, roughness: 0.35 }));
  wing.position.z = 0.8;
  state.ship.add(wing);
  const engine = new THREE.PointLight(0x40bfff, 3, 20);
  engine.position.z = 3;
  state.ship.add(engine);
  scene.add(state.ship);
}
function getForward() {
  return new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch)).normalize();
}
function fly(delta) {
  const forward = getForward();
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const thrust = state.keys.has('shift') ? 190 : 75;
  const direction = new THREE.Vector3();
  if (state.keys.has('w')) direction.add(forward);
  if (state.keys.has('s')) direction.sub(forward);
  if (state.keys.has('d')) direction.add(right);
  if (state.keys.has('a')) direction.sub(right);
  if (state.keys.has(' ')) direction.add(up);
  if (state.keys.has('control')) direction.sub(up);
  if (direction.lengthSq()) state.velocity.addScaledVector(direction.normalize(), thrust * delta);
  state.velocity.multiplyScalar(Math.pow(state.keys.has(' ') ? 0.25 : 0.985, delta * 60));
  state.position.addScaledVector(state.velocity, delta);
  state.ship.position.copy(state.position);
  state.ship.rotation.order = 'YXZ';
  state.ship.rotation.y = state.yaw;
  state.ship.rotation.x = -state.pitch;
  const cameraOffset = new THREE.Vector3(0, 4.5, 13).applyEuler(state.ship.rotation);
  camera.position.copy(state.position).add(cameraOffset);
  camera.lookAt(state.position.clone().addScaledVector(forward, 20));
}
function nearestPlanet() {
  let best = null, bestDistance = Infinity;
  for (const planet of state.planets) {
    const distance = state.position.distanceTo(planet.mesh.position) - planet.radius;
    if (distance < bestDistance) { best = planet; bestDistance = distance; }
  }
  return { planet: best, distance: bestDistance };
}
function updateHud() {
  const { planet, distance } = nearestPlanet();
  state.target = planet;
  ui.target.textContent = planet ? `${planet.resource.toUpperCase()} WORLD` : 'None';
  ui.range.textContent = planet ? `${Math.max(0, distance).toFixed(1)} km` : '—';
  ui.velocity.textContent = `${state.velocity.length().toFixed(1)} m/s`;
  ui.position.textContent = `${state.position.x.toFixed(0)}, ${state.position.y.toFixed(0)}, ${state.position.z.toFixed(0)}`;
}
function survey() {
  const { planet, distance } = nearestPlanet();
  if (!planet || distance > 32) {
    ui.notice.textContent = 'Survey scan failed: approach within 32 km of a planet.';
    return;
  }
  const key = `${state.systemIndex}:${planet.seed}`;
  const firstScan = !state.scanned.has(key);
  state.scanned.add(key);
  const grade = (0.35 + (planet.seed % 6400) / 10000).toFixed(2);
  ui.survey.textContent = `${planet.resource.toUpperCase()} deposit · resource grade ${grade} · radius ${planet.radius.toFixed(1)} km · ${firstScan ? 'new discovery logged' : 'previously surveyed'}.`;
  ui.notice.textContent = 'Survey complete. Mining, cargo, and bazaar integration are not implemented yet.';
}
function jumpSystem() {
  state.systemIndex++;
  generateSystem();
}

makeShip();
generateSystem();
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  ui.notice.textContent = document.pointerLockElement === canvas ? 'Flight controls active. Explore and survey the system.' : 'Click the scene to capture the mouse and begin flying.';
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return;
  state.yaw -= event.movementX * 0.0022;
  state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.0022, -1.45, 1.45);
});
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  state.keys.add(key);
  if ([' ', 'arrowup', 'arrowdown'].includes(key)) event.preventDefault();
  if (key === 'e' && !event.repeat) survey();
  if (key === 'j' && !event.repeat) jumpSystem();
});
document.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());
ui.warp.addEventListener('click', jumpSystem);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
});
function frame() {
  requestAnimationFrame(frame);
  const delta = Math.min(clock.getDelta(), 0.05);
  fly(delta);
  updateHud();
  renderer.render(scene, camera);
}
frame();
