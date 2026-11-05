import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js';

// Keep the checked-in game module intact while applying small, validated runtime
// corrections for system scale and the sun's radial lighting.
const sourceUrl = new URL('./exploration.js', import.meta.url);
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Could not load game client (${response.status})`);
let source = await response.text();

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) !== -1) {
    throw new Error(`Expected exactly one ${label} snippet in exploration.js`);
  }
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
  'const starRadius = 1_000_000 + random() * 500_000;',
  'const starRadius = 100_000 + random() * 50_000;',
  'star radius'
);
replaceOnce(
  'const radius = 500_000 + random() * 500_000;',
  'const radius = 50_000 + random() * 50_000;',
  'planet radius'
);
replaceOnce(
  '  renderer.toneMappingExposure = 1.25;',
  '  renderer.toneMappingExposure = 1.25;\n  renderer.shadowMap.enabled = true;\n  renderer.shadowMap.type = THREE.PCFSoftShadowMap;',
  'renderer setup'
);
replaceOnce(
  `  const sunLight = new THREE.DirectionalLight(starColor, 5.0);
  sunLight.position.set(0, 0, 1).multiplyScalar(starRadius * 4);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -5_000_000;
  sunLight.shadow.camera.right = 5_000_000;
  sunLight.shadow.camera.top = 5_000_000;
  sunLight.shadow.camera.bottom = -5_000_000;
  sunLight.shadow.camera.near = 100_000;
  sunLight.shadow.camera.far = 40_000_000;
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.05;
  sunLight.shadow.radius = 4;
  add(sunLight);
  add(sunLight.target);
  add(new THREE.AmbientLight(0x7188aa, 0.12));`,
  `  // A point source at the star gives each world a smooth radial terminator.
  // Scale luminous intensity with the system so restored-size systems stay bright.
  const sunLight = new THREE.PointLight(starColor, 125 * starRadius * starRadius, 0, 2);
  add(sunLight);
  add(new THREE.AmbientLight(0x7188aa, 0.08));`,
  'sun lighting'
);
replaceOnce(
  `    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.94,
      metalness: 0.015,
      emissive: new THREE.Color(color).multiplyScalar(0.02),
      emissiveIntensity: 0.03
    });`,
  `    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0.015 });`,
  'planet material'
);
replaceOnce(
  `  const gameUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(gameUrl);
  } finally {
    URL.revokeObjectURL(gameUrl);
  }`,
  `  const gameUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(gameUrl);
  } finally {
    URL.revokeObjectURL(gameUrl);
  }`,
  'loader tail'
);

const gameUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(gameUrl);
} finally {
  URL.revokeObjectURL(gameUrl);
}
