import * as THREE from 'three';

// Convert the scene's single sun directional light into a point source at the
// star's center. This gives planets radial illumination and a real night side.
const originalRender = THREE.WebGLRenderer.prototype.render;
const preparedMeshes = new WeakSet();
const preparedLights = new WeakSet();

THREE.WebGLRenderer.prototype.render = function renderWithSunShadows(scene, camera) {
  this.shadowMap.enabled = true;
  this.shadowMap.type = THREE.PCFSoftShadowMap;

  const sunLights = [];
  scene.traverse((object) => {
    if (object.isAmbientLight) object.intensity = 0.1;
    if (object.isDirectionalLight) sunLights.push(object);

    if (object.isMesh && !preparedMeshes.has(object)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material?.isMeshStandardMaterial)) {
        object.castShadow = true;
        object.receiveShadow = true;
        // Planet emissive light fills in the night side and obscures the terminator.
        if (object.geometry?.type === 'SphereGeometry') {
          for (const material of materials) {
            if (material?.isMeshStandardMaterial) material.emissiveIntensity = 0;
          }
        }
      } else {
        // The luminous sun surface must not occlude its own point light.
        object.castShadow = false;
      }
      preparedMeshes.add(object);
    }
  });

  for (const sun of sunLights) {
    if (preparedLights.has(sun)) continue;
    const parent = sun.parent || scene;
    const sourceDistance = Math.max(1, sun.position.length());
    const pointSun = new THREE.PointLight(sun.color, sun.intensity * sourceDistance * sourceDistance, 0, 2);
    pointSun.position.set(0, 0, 0);
    pointSun.castShadow = true;
    pointSun.shadow.mapSize.set(1024, 1024);
    pointSun.shadow.camera.near = 1_000;
    pointSun.shadow.camera.far = 40_000_000;
    pointSun.shadow.bias = -0.0001;
    pointSun.shadow.normalBias = 0.02;
    pointSun.shadow.radius = 3;
    pointSun.shadow.camera.updateProjectionMatrix();
    parent.add(pointSun);
    if (sun.target.parent) sun.target.parent.remove(sun.target);
    parent.remove(sun);
    preparedLights.add(sun);
  }

  return originalRender.call(this, scene, camera);
};
