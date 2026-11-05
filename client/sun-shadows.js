import * as THREE from 'three';

// Enable the custom sun-shadow setup. This is required for the game to use the
// special planet lighting pass, otherwise the star just behaves like a flat
// one-sided emitter and the terminator snaps abruptly.
const originalRender = THREE.WebGLRenderer.prototype.render;
const preparedMeshes = new WeakSet();
const preparedLights = new WeakSet();

THREE.WebGLRenderer.prototype.render = function renderWithSunShadows(scene, camera) {
  this.shadowMap.enabled = true;
  this.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.traverse((object) => {
    if (object.isAmbientLight) object.intensity = 0.12;

    if (object.isMesh && !preparedMeshes.has(object)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material?.isMeshStandardMaterial)) {
        object.castShadow = true;
        object.receiveShadow = true;

        if (object.geometry?.type === 'SphereGeometry') {
          for (const material of materials) {
            if (material?.isMeshStandardMaterial) {
              material.emissiveIntensity = 0.02;
            }
          }
        }
      }
      preparedMeshes.add(object);
    }

    if (object.isPointLight && object.intensity > 1e10 && object.position.lengthSq() < 1e-8 && !preparedLights.has(object)) {
      object.castShadow = true;
      object.shadow.mapSize.set(2048, 2048);
      object.shadow.camera.near = 100_000;
      object.shadow.camera.far = 80_000_000;
      object.shadow.bias = -0.00003;
      object.shadow.normalBias = 0.02;
      object.shadow.radius = 8;
      object.shadow.camera.updateProjectionMatrix();
      preparedLights.add(object);
    }
  });

  return originalRender.call(this, scene, camera);
};
