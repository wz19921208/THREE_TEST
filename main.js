import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { createFluidEffect } from "./fluid.js";

const scene = new THREE.Scene();

function createSkyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#abbcc6");
  gradient.addColorStop(0.42, "#b6c1c0");
  gradient.addColorStop(0.75, "#b9c1bc");
  gradient.addColorStop(1, "#b9beb8");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.keepAlive = true;
  return texture;
}

function linearChannelToSRGB(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function linearColorToCss(color) {
  return `rgb(${color
    .map((value) => Math.round(linearChannelToSRGB(value) * 255))
    .join(", ")})`;
}

function createSkyPlaneTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  const blue = linearColorToCss([0.28891, 0.46552, 0.60002]);
  const green = linearColorToCss([0.45, 0.51, 0.41]);
  gradient.addColorStop(0, blue);
  gradient.addColorStop(0.33, blue);
  gradient.addColorStop(0.87, green);
  gradient.addColorStop(1, green);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.keepAlive = true;
  return texture;
}

const backgroundSkyTexture = createSkyTexture();
const skyPlaneTexture = createSkyPlaneTexture();
skyPlaneTexture.flipY = false;
skyPlaneTexture.needsUpdate = true;
skyPlaneTexture.userData.keepAlive = true;
scene.background = backgroundSkyTexture;

function createRadialGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.1, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.7, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.keepAlive = true;
  return texture;
}

const particleGlowTexture = createRadialGlowTexture();
const PARTICLE_EMISSION_SCALE = 0.78;
const baseFog = new THREE.Fog(0xe6d6c1, 12, 45);
scene.fog = baseFog;

RectAreaLightUniformsLib.init();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.appendChild(renderer.domElement);

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
const parallaxScale = reducedMotion ? 0 : coarsePointer ? 0.5 : 1;
const fluidEffect =
  !reducedMotion && !coarsePointer
    ? createFluidEffect(renderer, { quality: 0.2 })
    : null;

let sceneRT = null;
let postScene = null;
let postCamera = null;
let postQuad = null;

if (fluidEffect) {
  sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;

  postScene = new THREE.Scene();
  postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    fluidEffect.compositeMaterial,
  );
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
}

function resizePostTargets() {
  if (!fluidEffect || !sceneRT) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  sceneRT.setSize(size.x, size.y);
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
  fluidEffect.resize(window.innerWidth, window.innerHeight);
  fluidEffect.compositeMaterial.uniforms.tScene.value = sceneRT.texture;
  fluidEffect.compositeMaterial.uniforms.tVelocity.value =
    fluidEffect.velocityTexture;
  fluidEffect.compositeMaterial.uniforms.uResolution.value.set(
    size.x,
    size.y,
  );
}

resizePostTargets();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2;
controls.target.set(0, 0.8, 0);

const hemi = new THREE.HemisphereLight(0xf7ecdf, 0xa48667, 0.75);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffe0b0, 2.2);
keyLight.position.set(9, 6, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -30;
keyLight.shadow.camera.right = 30;
keyLight.shadow.camera.top = 30;
keyLight.shadow.camera.bottom = -30;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 120;
keyLight.shadow.radius = 4;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xc7dce8, 0.5);
fillLight.position.set(-7, 4, 5);
scene.add(fillLight);

const rimDirectional = new THREE.DirectionalLight(0xffd2a1, 0.65);
rimDirectional.position.set(-2, 5, -8);
scene.add(rimDirectional);

const windowLight = new THREE.RectAreaLight(0xffe7c6, 5.5, 10, 8);
windowLight.position.set(-9, 7, 3);
windowLight.lookAt(0, 1.5, 0);
scene.add(windowLight);

const bounceLight = new THREE.PointLight(0xf0c79a, 10, 30);
bounceLight.position.set(3, 1.5, 2);
scene.add(bounceLight);

const warmAmbient = new THREE.HemisphereLight(0xffc48a, 0x7a4c2a, 0.55);
warmAmbient.visible = false;
scene.add(warmAmbient);

const demoLights = [
  hemi,
  keyLight,
  fillLight,
  rimDirectional,
  windowLight,
  bounceLight,
];

const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.32, 220, 32),
  new THREE.MeshStandardMaterial({
    color: 0xe3cfb5,
    metalness: 0.03,
    roughness: 0.65,
  }),
);
knot.position.y = 1.4;
knot.castShadow = true;
scene.add(knot);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.MeshStandardMaterial({
    color: 0xd8c2a4,
    metalness: 0,
    roughness: 0.9,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(18, 36, 0xb09474, 0xc7b193);
grid.position.y = 0.001;
grid.material.transparent = true;
grid.material.opacity = 0.24;
scene.add(grid);

function createParticleField({
  count,
  radiusMin,
  radiusMax,
  yMin,
  yMax,
  sizeMin,
  sizeMax,
  pointScale,
  maxPointSize,
  warmRatio,
}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const warm = new THREE.Color(0xfff3df);
  const cool = new THREE.Color(0xd8e8ee);

  for (let i = 0; i < count; i += 1) {
    const radius = radiusMin + Math.sqrt(Math.random()) * (radiusMax - radiusMin);
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    positions[i * 3 + 2] = Math.sin(angle) * radius;

    const color = Math.random() < warmRatio ? warm : cool;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        vec3 p = position;
        float drift = uTime * 0.35 + aPhase;
        p.x += sin(drift * 0.7) * 0.18;
        p.z += cos(drift * 0.55) * 0.18;
        p.y += sin(drift) * 0.22;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float depth = max(0.1, -mvPosition.z);
        gl_PointSize = clamp(
          aSize * uPixelRatio * (${pointScale.toFixed(1)} / depth),
          1.0,
          ${maxPointSize.toFixed(1)}
        );
        vTwinkle = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.2 + aPhase * 2.4));
        vColor = aColor;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float core = smoothstep(0.5, 0.0, distanceToCenter);
        float alpha = core * core * vTwinkle * 0.45;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return points;
}

const particles = createParticleField({
  count: 1400,
  radiusMin: 3,
  radiusMax: 30,
  yMin: -1,
  yMax: 16,
  sizeMin: 0.45,
  sizeMax: 1.1,
  pointScale: 46,
  maxPointSize: 6,
  warmRatio: 0.9,
});
scene.add(particles);

const fireflies = createParticleField({
  count: 180,
  radiusMin: 5,
  radiusMax: 24,
  yMin: 0.4,
  yMax: 4.5,
  sizeMin: 0.8,
  sizeMax: 1.7,
  pointScale: 58,
  maxPointSize: 9,
  warmRatio: 0.95,
});
scene.add(fireflies);

const importBtn = document.querySelector("#import-btn");
const cameraBtn = document.querySelector("#camera-btn");
const resetBtn = document.querySelector("#reset-btn");
const modelInput = document.querySelector("#model-file");
const statusText = document.querySelector("#import-status");
const hudHint = document.querySelector("#hud-hint");

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(
  "https://unpkg.com/three@0.186.1/examples/jsm/libs/draco/gltf/",
);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

let currentModel = null;
let mixer = null;
let importedCamera = null;
let defaultScene = null;
let cameraScene = null;
let usingCamera = false;
let importedLights = [];
let importedCameraShiftY = 0;
let cameraRig = null;
const cameraRigBaseQuaternion = new THREE.Quaternion();
const pointerNdc = new THREE.Vector2();
let cameraYaw = 0;
let cameraPitch = 0;

const CAMERA_VIEW_ASPECT = 16 / 9;
const MAX_CAMERA_YAW = THREE.MathUtils.degToRad(0.75);
const MAX_CAMERA_PITCH = THREE.MathUtils.degToRad(0.2);
const CAMERA_DAMPING = 2;
const cameraYawQuaternion = new THREE.Quaternion();
const cameraPitchQuaternion = new THREE.Quaternion();
const cameraYAxis = new THREE.Vector3(0, 1, 0);
const cameraXAxis = new THREE.Vector3(1, 0, 0);

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function disposeObject(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture && !value.userData?.keepAlive) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}

function clearModel() {
  if (currentModel) {
    scene.remove(currentModel);
    disposeObject(currentModel);
    currentModel = null;
  }
  mixer = null;
  importedCamera = null;
  defaultScene = null;
  cameraScene = null;
  usingCamera = false;
  importedLights = [];
  importedCameraShiftY = 0;
  cameraRig = null;
  cameraRigBaseQuaternion.identity();
  pointerNdc.set(0, 0);
  cameraYaw = 0;
  cameraPitch = 0;
  for (const light of demoLights) light.visible = true;
  warmAmbient.visible = false;
  particles.visible = true;
  fireflies.visible = true;
  controls.enabled = true;
  floor.visible = true;
  grid.visible = true;
  scene.fog = baseFog;
  cameraBtn.hidden = true;
  cameraBtn.textContent = "进入摄像机视角";
  if (hudHint) {
    hudHint.textContent = "拖动旋转 · 滚轮缩放";
  }
  syncCameraAspect(camera);
}

function syncCameraAspect(targetCamera, aspectOverride) {
  if (!targetCamera?.isPerspectiveCamera) return;
  targetCamera.aspect =
    aspectOverride ??
    (targetCamera === importedCamera && usingCamera
      ? CAMERA_VIEW_ASPECT
      : window.innerWidth / window.innerHeight);
  targetCamera.updateProjectionMatrix();
  if (targetCamera === importedCamera && importedCameraShiftY !== 0) {
    targetCamera.projectionMatrix.elements[9] = importedCameraShiftY * 2;
    targetCamera.projectionMatrixInverse
      .copy(targetCamera.projectionMatrix)
      .invert();
  }
}

function setupCameraRig(targetCamera) {
  if (!targetCamera?.parent || cameraRig) return;
  const parent = targetCamera.parent;
  const rig = new THREE.Group();
  rig.name = "HeroCameraRig";
  rig.position.copy(targetCamera.position);
  rig.quaternion.copy(targetCamera.quaternion);
  rig.scale.copy(targetCamera.scale);
  parent.add(rig);
  rig.updateMatrixWorld(true);
  rig.attach(targetCamera);
  cameraRig = rig;
  cameraRigBaseQuaternion.copy(rig.quaternion);
  cameraYaw = 0;
  cameraPitch = 0;
}

function updateCameraRig(dt) {
  if (!cameraRig || !usingCamera) return;

  const targetYaw = -pointerNdc.x * MAX_CAMERA_YAW * parallaxScale;
  const targetPitch = pointerNdc.y * MAX_CAMERA_PITCH * parallaxScale;
  const damping = 1 - Math.exp(-CAMERA_DAMPING * Math.min(dt, 0.05));

  cameraYaw += (targetYaw - cameraYaw) * damping;
  cameraPitch += (targetPitch - cameraPitch) * damping;

  cameraYawQuaternion.setFromAxisAngle(cameraYAxis, cameraYaw);
  cameraPitchQuaternion.setFromAxisAngle(cameraXAxis, cameraPitch);
  cameraRig.quaternion
    .copy(cameraRigBaseQuaternion)
    .multiply(cameraYawQuaternion)
    .multiply(cameraPitchQuaternion);
  cameraRig.updateMatrixWorld(true);
}

function enterCameraView(updateStatus = true) {
  if (!importedCamera) return;
  usingCamera = true;
  controls.enabled = false;
  if (defaultScene) {
    defaultScene.visible = cameraScene === defaultScene;
  }
  if (cameraScene) {
    cameraScene.visible = true;
  }
  floor.visible = false;
  grid.visible = false;
  knot.visible = false;
  scene.fog = null;
  syncCameraAspect(importedCamera);
  importedCamera.updateWorldMatrix(true, false);
  cameraBtn.textContent = "退出摄像机视角";
  if (hudHint) {
    hudHint.textContent = "移动鼠标查看镜头视差 · 快速划过查看拖尾";
  }
  if (updateStatus) {
    setStatus(`已进入 ${cameraDisplayName(importedCamera)} 摄像机视角`);
  }
}

function exitCameraView() {
  usingCamera = false;
  controls.enabled = true;
  if (defaultScene) defaultScene.visible = true;
  if (cameraScene && cameraScene !== defaultScene) cameraScene.visible = false;
  floor.visible = !currentModel;
  grid.visible = !currentModel;
  knot.visible = !currentModel;
  scene.fog = baseFog;
  syncCameraAspect(camera);
  if (importedCamera) {
    cameraBtn.textContent = `进入 ${cameraDisplayName(importedCamera)} 视角`;
  }
  if (hudHint) {
    hudHint.textContent = "拖动旋转 · 滚轮缩放";
  }
}

function normalizeCameraName(name) {
  return name.toLowerCase().replace(/^_+/, "").replace(/[^a-z0-9]/g, "");
}

function isRequestedCamera(targetCamera) {
  if (!targetCamera) return false;
  return normalizeCameraName(targetCamera.name) === "camera001";
}

function cameraDisplayName(targetCamera) {
  if (!targetCamera) return "摄像机";
  return isRequestedCamera(targetCamera) ? "camera.001" : targetCamera.name;
}

function normalizeNodeName(name) {
  return (name || "").replace(/\./g, "").toLowerCase();
}

const blenderLightSettings = new Map([
  [
    "天光001",
    { intensity: 0.12, color: [0.45, 0.62, 0.85] },
  ],
  [
    "天光002",
    { intensity: 3, color: [1, 0.9, 0.78] },
  ],
  [
    "日光-主光",
    { intensity: 5, color: [1, 0.82, 0.64] },
  ],
  [
    "辅助光",
    { intensity: 2, color: [0.9, 0.78, 0.64] },
  ],
]);

function findImportedCamera(sceneRoots) {
  const entries = [];
  for (const sceneRoot of sceneRoots) {
    sceneRoot.traverse((object) => {
      if (object.isCamera) entries.push({ camera: object, sceneRoot });
    });
  }
  if (entries.length === 0) return null;
  return (
    entries.find((entry) => isRequestedCamera(entry.camera)) || entries[0]
  );
}

function restoreSpecialMaterials(modelRoot) {
  const replacements = new Map();
  const originals = new Set();
  let skyMaterial = null;

  modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const nextMaterials = materials.map((material) => {
      if (!material) return material;
      const name = material.name || "";

      if (name === "Sky_Gradient_Reference") {
        originals.add(material);
        if (!skyMaterial) {
          skyMaterial = new THREE.MeshBasicMaterial({
            name: "Sky_Gradient_Restored",
            map: skyPlaneTexture,
            color: new THREE.Color(1.7, 1.7, 1.7),
            side: THREE.DoubleSide,
            toneMapped: true,
            depthWrite: false,
          });
        }
        object.renderOrder = -10;
        return skyMaterial;
      }

      if (name.startsWith("Cloud_Mat_")) {
        originals.add(material);
        const key = material.uuid;
        if (!replacements.has(key)) {
          replacements.set(
            key,
            new THREE.MeshBasicMaterial({
              name: `${name}_Restored`,
              map: material.emissiveMap || material.map,
              color: new THREE.Color(1.5, 1.5, 1.5),
              side: THREE.DoubleSide,
              transparent: true,
              depthWrite: false,
              blending: THREE.NormalBlending,
              toneMapped: true,
              alphaTest: 0.001,
            }),
          );
        }
        object.renderOrder = 1;
        object.frustumCulled = false;
        return replacements.get(key);
      }

      if (name.startsWith("Particle_Warm_")) {
        originals.add(material);
        const key = material.uuid;
        if (!replacements.has(key)) {
          const strengths = {
            Particle_Warm_09: 0.5,
            Particle_Warm_06: 0.6,
            Particle_Warm_12: 1.2,
            Particle_Warm_16: 1.6,
          };
          const strength =
            (strengths[name] ?? 1) * PARTICLE_EMISSION_SCALE;
          const color = new THREE.Color(1, 0.96, 0.9).multiplyScalar(
            strength,
          );
          replacements.set(
            key,
            new THREE.MeshBasicMaterial({
              name: `${name}_Soft`,
              map: particleGlowTexture,
              color,
              side: THREE.DoubleSide,
              transparent: true,
              depthWrite: false,
              blending: THREE.NormalBlending,
              toneMapped: true,
              alphaTest: 0.001,
              opacity: 0.5,
            }),
          );
        }
        object.renderOrder = 2;
        object.frustumCulled = false;
        return replacements.get(key);
      }

      return material;
    });

    object.material = Array.isArray(object.material)
      ? nextMaterials
      : nextMaterials[0];
  });

  for (const material of originals) material.dispose();
}

function improveTextureQuality(modelRoot) {
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const seen = new Set();
  const textureKeys = [
    "map",
    "emissiveMap",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "alphaMap",
  ];

  modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const key of textureKeys) {
        const texture = material[key];
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
      }
    }
  });
}

function handleLoadedModel(gltf, label, { autoEnterCamera = false } = {}) {
  clearModel();

  const model = gltf.scene;
  const modelRoot = new THREE.Group();
  modelRoot.name = "ImportedModelRoot";
  modelRoot.add(model);
  for (const sceneRoot of gltf.scenes) {
    if (sceneRoot === model) continue;
    sceneRoot.visible = false;
    modelRoot.add(sceneRoot);
  }
  model.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const maxDimension = Math.max(rawSize.x, rawSize.y, rawSize.z) || 1;
  const modelScale = 3.2 / maxDimension;
  model.scale.multiplyScalar(modelScale);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    object.receiveShadow = true;
    const objectName = (object.name || "").toLowerCase();
    const material = Array.isArray(object.material)
      ? object.material[0]
      : object.material;
    const isEffectMesh =
      objectName.includes("particle") ||
      objectName.includes("cloud") ||
      material?.transparent === true;
    object.castShadow = !isEffectMesh;
  });

  restoreSpecialMaterials(modelRoot);
  improveTextureQuality(modelRoot);

  let hasModelParticles = false;
  modelRoot.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (
      materials.some((material) =>
        (material?.name || "").startsWith("Particle_Warm_"),
      )
    ) {
      hasModelParticles = true;
    }
  });
  particles.visible = !hasModelParticles;
  fireflies.visible = !hasModelParticles;

  importedLights = [];
  modelRoot.traverse((object) => {
    if (object.isLight) importedLights.push(object);
  });
  if (importedLights.length > 0) {
    for (const light of importedLights) {
      const settings = blenderLightSettings.get(normalizeNodeName(light.name));
      if (settings) {
        light.intensity = settings.intensity;
        light.color.setRGB(
          settings.color[0],
          settings.color[1],
          settings.color[2],
          THREE.LinearSRGBColorSpace,
        );
      } else {
        light.intensity = Math.max(0.1, light.intensity / 683);
      }
      light.castShadow = false;
    }
    for (const light of demoLights) light.visible = false;
    warmAmbient.visible = true;
  }

  scene.add(modelRoot);
  currentModel = modelRoot;
  defaultScene = model;
  knot.visible = false;
  floor.visible = false;
  grid.visible = false;
  resetBtn.hidden = false;

  const cameraMatch = findImportedCamera(gltf.scenes);
  importedCamera = cameraMatch?.camera || null;
  cameraScene = cameraMatch?.sceneRoot || null;
  importedCameraShiftY =
    importedCamera && normalizeNodeName(importedCamera.name) === "视口"
      ? -0.09
      : 0;
  if (importedCamera) {
    cameraBtn.hidden = false;
    cameraBtn.textContent = `进入 ${cameraDisplayName(importedCamera)} 视角`;
    if (cameraScene === defaultScene) {
      importedCamera.near = Math.max(0.001, importedCamera.near * modelScale);
      importedCamera.far = Math.max(
        importedCamera.near * 10,
        importedCamera.far * modelScale,
      );
      importedCamera.updateProjectionMatrix();
    }
    setupCameraRig(importedCamera);
    syncCameraAspect(
      importedCamera,
      autoEnterCamera ? CAMERA_VIEW_ASPECT : undefined,
    );
  }

  if (gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const cloudActions = [];
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.play();

      if (clip.name.startsWith("Cloud_Plane")) {
        const track = clip.tracks.find((item) =>
          item.name.endsWith(".position"),
        );
        const planeName = clip.name.split("动作")[0];
        const cloudObject = model.getObjectByName(planeName);
        if (track && cloudObject) {
          const stride = track.getValueSize();
          const startZ = track.values[2];
          const endZ = track.values[track.values.length - stride + 2];
          const range = endZ - startZ;
          const ratio =
            Math.abs(range) > 1e-6
              ? THREE.MathUtils.clamp(
                  (cloudObject.position.z - startZ) / range,
                  0,
                  1,
                )
              : 0;
          cloudActions.push({
            action,
            phase: ratio * clip.duration,
          });
        }
      }
    }
    mixer.update(0);
    for (const { action, phase } of cloudActions) {
      action.time = phase;
    }
    mixer.update(0);
  }

  camera.position.set(4, 3, 6);
  controls.target.set(0, 1.2, 0);
  controls.update();

  if (importedCamera && (autoEnterCamera || isRequestedCamera(importedCamera))) {
    enterCameraView(false);
    setStatus(
      `已加载：${label} · 已进入 ${cameraDisplayName(importedCamera)} 视角`,
    );
  } else {
    setStatus(`已加载：${label}`);
  }
}

function loadModelUrl(url, label, options = {}) {
  setStatus(`正在加载 ${label}…`);
  gltfLoader.load(
    url,
    (gltf) => handleLoadedModel(gltf, label, options),
    (xhr) => {
      if (!xhr.total) return;
      const percent = Math.round((xhr.loaded / xhr.total) * 100);
      setStatus(`正在加载 ${label}… ${percent}%`);
    },
    (error) => {
      console.error(error);
      setStatus(`加载失败：${label}`, true);
    },
  );
}

async function loadModelParts(urls, label, options = {}) {
  setStatus(`正在加载 ${label}…`);
  try {
    const buffers = [];
    let loadedBytes = 0;
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${url}`);
      }
      const buffer = await response.arrayBuffer();
      buffers.push(buffer);
      loadedBytes += buffer.byteLength;
      setStatus(
        `正在加载 ${label}… ${(loadedBytes / 1024 / 1024).toFixed(1)} MB`,
      );
    }

    const totalBytes = buffers.reduce(
      (total, buffer) => total + buffer.byteLength,
      0,
    );
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buffer of buffers) {
      combined.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }

    gltfLoader.parse(
      combined.buffer,
      "",
      (gltf) => handleLoadedModel(gltf, label, options),
      (error) => {
        console.error(error);
        setStatus(`加载失败：${label}`, true);
      },
    );
  } catch (error) {
    console.error(error);
    setStatus(`加载失败：${label}`, true);
  }
}

function loadModelFile(file) {
  if (!file) return;
  if (!/\.(glb|gltf)$/i.test(file.name)) {
    setStatus("请选择 .glb 或 .gltf 文件", true);
    return;
  }

  const url = URL.createObjectURL(file);
  gltfLoader.load(
    url,
    (gltf) => {
      URL.revokeObjectURL(url);
      handleLoadedModel(gltf, file.name);
    },
    (xhr) => {
      if (!xhr.total) return;
      const percent = Math.round((xhr.loaded / xhr.total) * 100);
      setStatus(`正在加载 ${file.name}… ${percent}%`);
    },
    (error) => {
      URL.revokeObjectURL(url);
      console.error(error);
      setStatus(
        "加载失败：请确认 .gltf 的 .bin 和贴图与它放在同一目录，或改用 .glb",
        true,
      );
    },
  );
}

function restoreDemo() {
  clearModel();
  knot.visible = true;
  resetBtn.hidden = true;
  camera.position.set(4, 3, 6);
  controls.target.set(0, 0.8, 0);
  controls.update();
  setStatus("支持 .glb / .gltf，也可直接把模型拖进窗口");
}

importBtn.addEventListener("click", () => modelInput.click());
cameraBtn.addEventListener("click", () => {
  if (usingCamera) {
    exitCameraView();
    setStatus(`已退出 ${cameraDisplayName(importedCamera)} 视角`);
  } else {
    enterCameraView();
  }
});
modelInput.addEventListener("change", () => {
  loadModelFile(modelInput.files?.[0]);
  modelInput.value = "";
});
resetBtn.addEventListener("click", restoreDemo);

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add("dragging");
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  loadModelFile(event.dataTransfer?.files?.[0]);
});

let lastPointerUv = null;

window.addEventListener(
  "pointermove",
  (event) => {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const ndcX = THREE.MathUtils.clamp(
      (event.clientX / width) * 2 - 1,
      -1,
      1,
    );
    const ndcY = THREE.MathUtils.clamp(
      -((event.clientY / height) * 2 - 1),
      -1,
      1,
    );
    pointerNdc.set(ndcX, ndcY);

    const uvX = event.clientX / width;
    const uvY = 1 - event.clientY / height;
    if (lastPointerUv) {
      const dx = uvX - lastPointerUv.x;
      const dy = uvY - lastPointerUv.y;
      if (fluidEffect && usingCamera) {
        fluidEffect.addPointerDelta(uvX, uvY, dx, dy);
      }
    }
    lastPointerUv = { x: uvX, y: uvY };
  },
  { passive: true },
);

window.addEventListener("pointerleave", () => {
  lastPointerUv = null;
});
window.addEventListener("blur", () => {
  lastPointerUv = null;
});

const pageParams = new URLSearchParams(window.location.search);
if (pageParams.get("demo") !== "1") {
  loadModelParts(
    [
      "./web_Mesh.glb.part0",
      "./web_Mesh.glb.part1",
    ],
    "web_Mesh.glb",
    { autoEnterCamera: true },
  );
}

const timer = new THREE.Timer();
timer.connect(document);

function getCameraViewport() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  let viewWidth = width;
  let viewHeight = width / CAMERA_VIEW_ASPECT;
  if (viewHeight > height) {
    viewHeight = height;
    viewWidth = height * CAMERA_VIEW_ASPECT;
  }
  return {
    width,
    height,
    viewWidth,
    viewHeight,
    viewX: (width - viewWidth) / 2,
    viewY: (height - viewHeight) / 2,
  };
}

function animate(timestamp) {
  timer.update(timestamp);
  const t = timer.getElapsed();
  const delta = timer.getDelta();
  if (knot.visible) {
    knot.rotation.x = t * 0.35;
    knot.rotation.y = t * 0.5;
    knot.position.y = 1.4 + Math.sin(t * 1.4) * 0.15;
  }
  if (mixer) mixer.update(delta);
  particles.rotation.y = t * 0.012;
  fireflies.rotation.y = -t * 0.018;
  particles.material.uniforms.uTime.value = t;
  fireflies.material.uniforms.uTime.value = t;
  if (bounceLight.visible) {
    bounceLight.intensity = 10 + Math.sin(t * 0.8) * 1.2;
  }
  controls.update();
  updateCameraRig(delta);

  if (usingCamera && importedCamera) {
    const viewport = getCameraViewport();
    syncCameraAspect(importedCamera, CAMERA_VIEW_ASPECT);
    importedCamera.updateWorldMatrix(true, false);

    if (fluidEffect && sceneRT && postScene && postCamera) {
      renderer.setRenderTarget(sceneRT);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, viewport.width, viewport.height);
      renderer.setClearColor(0xf0e0ca, 1);
      renderer.clear();
      renderer.setViewport(
        viewport.viewX,
        viewport.viewY,
        viewport.viewWidth,
        viewport.viewHeight,
      );
      renderer.setScissor(
        viewport.viewX,
        viewport.viewY,
        viewport.viewWidth,
        viewport.viewHeight,
      );
      renderer.setScissorTest(true);
      const autoClear = renderer.autoClear;
      const toneMapping = renderer.toneMapping;
      renderer.autoClear = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.render(scene, importedCamera);
      renderer.toneMapping = toneMapping;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(null);

      fluidEffect.update();
      fluidEffect.compositeMaterial.uniforms.tScene.value = sceneRT.texture;
      fluidEffect.compositeMaterial.uniforms.tVelocity.value =
        fluidEffect.velocityTexture;

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, viewport.width, viewport.height);
      renderer.render(postScene, postCamera);
    } else {
      fluidEffect?.update();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, viewport.width, viewport.height);
      renderer.setClearColor(0xf0e0ca, 1);
      renderer.clear();
      renderer.setViewport(
        viewport.viewX,
        viewport.viewY,
        viewport.viewWidth,
        viewport.viewHeight,
      );
      renderer.setScissor(
        viewport.viewX,
        viewport.viewY,
        viewport.viewWidth,
        viewport.viewHeight,
      );
      renderer.setScissorTest(true);
      renderer.render(scene, importedCamera);
    }
  } else {
    fluidEffect?.update();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.render(scene, camera);
  }
}

renderer.setAnimationLoop(animate);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncCameraAspect(importedCamera);
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizePostTargets();
  particles.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  fireflies.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
});
