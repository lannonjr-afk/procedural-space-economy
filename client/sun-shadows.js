import * as THREE from 'three';

// Replace the distant directional source with a point source at the star and
// soften the planet terminator with a subtle smooth twilight contribution.
const originalRender = THREE.WebGLRenderer.prototype.render;
const preparedMeshes = new WeakSet();
const convertedLights = new WeakSet();
const twilightMaterials = new Set();

function enableTwilight(material) {
  if (!material?.isMeshStandardMaterial || material.userData.twilightEnabled) return;

  const sunPositionView = { value: new THREE.Vector3() };
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.call(material, shader, renderer);
    shader.uniforms.uSunPositionView = sunPositionView;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uSunPositionView;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      // A broad, low-intensity twilight band smooths the visual day/night terminator.
      float sunFacing = dot(normalize(normal), normalize(uSunPositionView - vViewPosition));
      float twilight = smoothstep(-0.32, 0.22, sunFacing);
      outgoingLight += diffuseColor.rgb * vec3(0.035, 0.075, 0.095) * twilight;`
    );
  };
  material.userData.twilightEnabled = true;
  material.needsUpdate = true;
  twilightMaterials.add(sunPositionView);
}

THREE.WebGLRenderer.prototype.render = function renderWithSoftPlanetLighting(scene, camera) {
  this.shadowMap.enabled = true;
  this.shadowMap.type = THREE.PCFSoftShadowMap;
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  scene.traverse((object) => {
    if (object.isAmbientLight) object.intensity = 0.1;

    if (object.isMesh && !preparedMeshes.has(object)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (object.geometry?.type === 'SphereGeometry') {
        for (const material of materials) {
          enableTwilight(material);
          if (material?.isMeshStandardMaterial) material.emissiveIntensity = 0;
        }
      }
      if (materials.some((material) => material?.isMeshStandardMaterial)) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
      preparedMeshes.add(object);
    }

    if (object.isDirectionalLight && !convertedLights.has(object)) {
      // The game's directional sun is positioned on +Z; convert its intensity to
      // an equivalent inverse-square point source at the origin of the system.
      const sourceDistance = Math.max(1, object.position.length());
      const parent = object.parent || scene;
      const pointSun = new THREE.PointLight(object.color, object.intensity * sourceDistance * sourceDistance, 0, 2);
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
      if (object.target.parent) object.target.parent.remove(object.target);
      parent.remove(object);
      convertedLights.add(object);
    }
  });

  const sunPositionView = new THREE.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
  for (const uniform of twilightMaterials) uniform.value.copy(sunPositionView);

  return originalRender.call(this, scene, camera);
};
