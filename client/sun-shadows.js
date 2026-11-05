import * as THREE from 'three';

// The star is a point light at the system origin. Enable its shadow map and prepare
// meshes as systems are generated, so shadow casting continues after a system jump.
const originalRender = THREE.WebGLRenderer.prototype.render;
const preparedMeshes = new WeakSet();
const preparedLights = new WeakSet();

THREE.WebGLRenderer.prototype.render = function renderWithSunShadows(scene, camera) {
  this.shadowMap.enabled = true;
  this.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.traverse((object) => {
    if (object.isAmbientLight) {
      // Keep nightsides dark enough for the sun-cast shadows to remain visible.
      object.intensity = 0.1;
    }

    if (object.isMesh && !preparedMeshes.has(object)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material?.isMeshStandardMaterial)) {
        object.castShadow = true;
        object.receiveShadow = true;
        // Planet emissive glow would fill in the night side and obscure real shadows.
        if (object.geometry?.type === 'SphereGeometry') {
          for (const material of materials) {
            if (material?.isMeshStandardMaterial) material.emissiveIntensity = 0;
          }
        }
      }
      preparedMeshes.add(object);
    }

    if (object.isPointLight && object.intensity > 1e10 && object.position.lengthSq() < 1e-8 && !preparedLights.has(object)) {
      object.castShadow = true;
      object.shadow.mapSize.set(1024, 1024);
      object.shadow.camera.near = 100_000;
      object.shadow.camera.far = 50_000_000;
      object.shadow.bias = -0.0001;
      object.shadow.normalBias = 0.02;
      object.shadow.radius = 3;
      object.shadow.camera.updateProjectionMatrix();
      preparedLights.add(object);
    }
  });

  return originalRender.call(this, scene, camera);
};
