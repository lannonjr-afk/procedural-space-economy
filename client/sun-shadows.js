import * as THREE from 'three';

// Convert the system's directional sun into a point source at the star's center,
// then add a narrow twilight gradient to planet surfaces to soften the terminator.
const originalRender = THREE.WebGLRenderer.prototype.render;
const preparedMeshes = new WeakSet();
const preparedLights = new WeakSet();
const planetLightingUniforms = new Set();

function preparePlanetMaterial(material) {
  if (!material?.isMeshStandardMaterial || material.userData.hasTwilightShader) return;

  const twilight = { value: new THREE.Vector3() };
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.call(material, shader, renderer);
    shader.uniforms.uSunPositionView = twilight;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uSunPositionView;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      // A restrained twilight fill feathers the day/night boundary without lighting the whole nightside.
      float sunFacing = dot(normalize(normal), normalize(uSunPositionView - vViewPosition));
      float twilight = smoothstep(-0.24, 0.16, sunFacing);
      outgoingLight += diffuseColor.rgb * vec3(0.025, 0.055, 0.075) * twilight;`
    );
  };
  material.userData.hasTwilightShader = true;
  material.needsUpdate = true;
  planetLightingUniforms.add({ material, twilight });
}

THREE.WebGLRenderer.prototype.render = function renderWithSmoothSunShadows(scene, camera) {
  this.shadowMap.enabled = true;
  this.shadowMap.type = THREE.PCFSoftShadowMap;
  camera.updateMatrixWorld();

  const sunLights = [];
  scene.traverse((object) => {
    if (object.isAmbientLight) object.intensity = 0.1;
    if (object.isDirectionalLight) sunLights.push(object);

    if (object.isMesh && !preparedMeshes.has(object)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material?.isMeshStandardMaterial)) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.geometry?.type === 'SphereGeometry') {
          for (const material of materials) {
            preparePlanetMaterial(material);
            // Avoid self-illumination filling in the planet's night side.
            if (material?.isMeshStandardMaterial) material.emissiveIntensity = 0;
          }
        }
      } else {
        // The visible star surface must not occlude light from the central source.
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

  const sunPositionWorld = new THREE.Vector3();
  const sun = scene.children.find((object) => object.isPointLight && object.castShadow && object.position.lengthSq() < 1e-8);
  if (sun) {
    sun.getWorldPosition(sunPositionWorld);
    sunPositionWorld.applyMatrix4(camera.matrixWorldInverse);
    for (const { material, twilight } of planetLightingUniforms) {
      if (material.userData.hasTwilightShader) twilight.value.copy(sunPositionWorld);
    }
  }

  return originalRender.call(this, scene, camera);
};
