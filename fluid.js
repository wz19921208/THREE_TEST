import * as THREE from "three";

const FLUID_STRENGTH = 1.8;

const QUAD_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const CLEAR_FRAGMENT_SHADER = `
  precision highp float;

  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

const SPLAT_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uPoint;
  uniform vec2 uDelta;
  uniform float uRadius;
  uniform float uAspect;
  uniform float uForce;

  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float brush = exp(-dot(p, p) / max(uRadius * uRadius, 0.0000001));
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += uDelta * uForce * brush;
    velocity = clamp(velocity, vec2(-20.0), vec2(20.0));
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const ADVECTION_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform float uDt;
  uniform float uDissipation;

  void main() {
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    vec2 coord = clamp(
      vUv - velocity * uDt,
      vec2(0.001),
      vec2(0.999)
    );
    vec2 advected = texture2D(uVelocity, coord).xy;
    gl_FragColor = vec4(advected * uDissipation, 0.0, 1.0);
  }
`;

const DIVERGENCE_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;

  void main() {
    float left = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
    float top = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
    float divergence = 0.5 * (right - left + top - bottom);
    gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
  }
`;

const PRESSURE_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexelSize;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (left + right + bottom + top - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uPressure;
  uniform vec2 uTexelSize;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= 0.5 * vec2(right - left, top - bottom);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tVelocity;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uDistortion;
  uniform float uBlur;
  uniform float uBrightness;
  uniform float uContentAspect;
  uniform vec3 uMatteColor;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec3 blurSample(
    vec2 uv,
    float radius,
    float index,
    float phase
  ) {
    float angle =
      index * 2.39996323 +
      phase +
      hash(uv * 1000.0 + index) * 6.2831853;
    float distanceFromCenter =
      sqrt(hash(uv * 2000.0 + index * 3.17)) * radius;
    vec2 offset =
      vec2(cos(angle), sin(angle)) * distanceFromCenter;
    return texture2D(
      tScene,
      clamp(uv + offset, vec2(0.001), vec2(0.999))
    ).rgb;
  }

  vec3 circularBlur(vec2 uv, float radius) {
    vec3 sum = blurSample(uv, radius, 0.0, 0.0);
    sum += blurSample(uv, radius, 1.0, 0.7);
    sum += blurSample(uv, radius, 2.0, 1.4);
    sum += blurSample(uv, radius, 3.0, 2.1);
    sum += blurSample(uv, radius, 4.0, 2.8);
    sum += blurSample(uv, radius, 5.0, 3.5);
    sum += blurSample(uv, radius, 6.0, 4.2);
    sum += blurSample(uv, radius, 7.0, 4.9);
    return sum / 8.0;
  }

  void main() {
    float screenAspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 contentMin = vec2(0.0);
    vec2 contentMax = vec2(1.0);
    if (screenAspect > uContentAspect) {
      float contentWidth = uContentAspect / screenAspect;
      contentMin.x = (1.0 - contentWidth) * 0.5;
      contentMax.x = 1.0 - contentMin.x;
    } else {
      float contentHeight = screenAspect / uContentAspect;
      contentMin.y = (1.0 - contentHeight) * 0.5;
      contentMax.y = 1.0 - contentMin.y;
    }

    if (
      vUv.x < contentMin.x ||
      vUv.x > contentMax.x ||
      vUv.y < contentMin.y ||
      vUv.y > contentMax.y
    ) {
      gl_FragColor = vec4(uMatteColor, 1.0);
      return;
    }

    vec2 velocity = texture2D(tVelocity, vUv).xy;
    float speed = min(length(velocity), 1.0);
    vec2 warpVelocity = clamp(velocity, vec2(-6.0), vec2(6.0));
    vec2 warpedUv = clamp(
      vUv - warpVelocity * uDistortion,
      vec2(0.001),
      vec2(0.999)
    );

    vec3 sceneColor = texture2D(tScene, warpedUv).rgb;
    float blend = smoothstep(0.05, 0.8, speed);
    vec3 color = sceneColor;

    if (blend > 0.001) {
      float blurRadius = min(speed * uBlur / uResolution.x, 0.04);
      vec3 blurredColor = circularBlur(warpedUv, blurRadius);
      color = mix(sceneColor, blurredColor, blend);
    }

    color *= 1.0 + speed * uBrightness;

    float grain = (hash(vUv * uResolution + uTime) - 0.5) * 0.03;
    color += grain;

    float vignette = smoothstep(0.95, 0.35, length(vUv - 0.5));
    color *= mix(1.0, vignette, 0.06);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createDataTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  return target;
}

function createPassMaterial(fragmentShader, uniforms = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX_SHADER,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createFluidEffect(renderer, { quality = 0.2 } = {}) {
  if (!renderer.capabilities.isWebGL2) return null;

  const passScene = new THREE.Scene();
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  passScene.add(quad);

  const clearMaterial = createPassMaterial(CLEAR_FRAGMENT_SHADER);
  const splatMaterial = createPassMaterial(SPLAT_FRAGMENT_SHADER, {
    uVelocity: { value: null },
    uPoint: { value: new THREE.Vector2(0.5, 0.5) },
    uDelta: { value: new THREE.Vector2() },
    uRadius: { value: 0.03 },
    uAspect: { value: 1 },
    uForce: { value: 80 * FLUID_STRENGTH },
  });
  const advectionMaterial = createPassMaterial(ADVECTION_FRAGMENT_SHADER, {
    uVelocity: { value: null },
    uDt: { value: 1 / 120 },
    uDissipation: { value: 0.99 },
  });
  const divergenceMaterial = createPassMaterial(
    DIVERGENCE_FRAGMENT_SHADER,
    {
      uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2() },
    },
  );
  const pressureMaterial = createPassMaterial(PRESSURE_FRAGMENT_SHADER, {
    uPressure: { value: null },
    uDivergence: { value: null },
    uTexelSize: { value: new THREE.Vector2() },
  });
  const gradientMaterial = createPassMaterial(GRADIENT_FRAGMENT_SHADER, {
    uVelocity: { value: null },
    uPressure: { value: null },
    uTexelSize: { value: new THREE.Vector2() },
  });

  const compositeMaterial = createPassMaterial(
    COMPOSITE_FRAGMENT_SHADER,
    {
      tScene: { value: null },
      tVelocity: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDistortion: { value: 0.003 * FLUID_STRENGTH },
      uBlur: { value: 15 * FLUID_STRENGTH },
      uBrightness: { value: 0.25 * FLUID_STRENGTH },
      uContentAspect: { value: 16 / 9 },
      uMatteColor: { value: new THREE.Vector3(0.941, 0.878, 0.792) },
    },
  );
  compositeMaterial.toneMapped = true;

  let width = 1;
  let height = 1;
  let velocityA = null;
  let velocityB = null;
  let pressureA = null;
  let pressureB = null;
  let divergence = null;
  let active = false;
  let activeUntil = 0;
  let accumulator = 0;
  let lastTime = performance.now();
  const pointer = {
    x: 0.5,
    y: 0.5,
    dx: 0,
    dy: 0,
    pending: false,
  };

  function renderPass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCamera);
  }

  function swapVelocity() {
    const next = velocityA;
    velocityA = velocityB;
    velocityB = next;
  }

  function swapPressure() {
    const next = pressureA;
    pressureA = pressureB;
    pressureB = next;
  }

  function clearSimulation() {
    renderPass(clearMaterial, velocityA);
    renderPass(clearMaterial, velocityB);
    renderPass(clearMaterial, pressureA);
    renderPass(clearMaterial, pressureB);
    renderPass(clearMaterial, divergence);
    renderer.setRenderTarget(null);
    active = false;
    accumulator = 0;
  }

  function rebuildTargets(nextWidth, nextHeight) {
    const newWidth = Math.max(64, Math.round(nextWidth * quality));
    const newHeight = Math.max(64, Math.round(nextHeight * quality));
    if (
      velocityA &&
      newWidth === width &&
      newHeight === height
    ) {
      return;
    }

    for (const target of [
      velocityA,
      velocityB,
      pressureA,
      pressureB,
      divergence,
    ]) {
      target?.dispose();
    }

    width = newWidth;
    height = newHeight;
    velocityA = createDataTarget(width, height);
    velocityB = createDataTarget(width, height);
    pressureA = createDataTarget(width, height);
    pressureB = createDataTarget(width, height);
    divergence = createDataTarget(width, height);

    const texelSize = new THREE.Vector2(1 / width, 1 / height);
    divergenceMaterial.uniforms.uTexelSize.value.copy(texelSize);
    pressureMaterial.uniforms.uTexelSize.value.copy(texelSize);
    gradientMaterial.uniforms.uTexelSize.value.copy(texelSize);
    splatMaterial.uniforms.uAspect.value = width / height;

    clearSimulation();
  }

  function splat() {
    if (!pointer.pending) return;
    splatMaterial.uniforms.uVelocity.value = velocityA.texture;
    splatMaterial.uniforms.uPoint.value.set(pointer.x, pointer.y);
    splatMaterial.uniforms.uDelta.value.set(pointer.dx, pointer.dy);
    splatMaterial.uniforms.uRadius.value =
      40 / Math.max(window.innerHeight, 1);
    renderPass(splatMaterial, velocityB);
    swapVelocity();
    pointer.dx = 0;
    pointer.dy = 0;
    pointer.pending = false;
  }

  function simulate(step) {
    splat();

    advectionMaterial.uniforms.uVelocity.value = velocityA.texture;
    advectionMaterial.uniforms.uDt.value = step;
    advectionMaterial.uniforms.uDissipation.value = Math.sqrt(0.98);
    renderPass(advectionMaterial, velocityB);
    swapVelocity();

    divergenceMaterial.uniforms.uVelocity.value = velocityA.texture;
    renderPass(divergenceMaterial, divergence);

    renderPass(clearMaterial, pressureA);
    pressureMaterial.uniforms.uPressure.value = pressureA.texture;
    pressureMaterial.uniforms.uDivergence.value = divergence.texture;
    renderPass(pressureMaterial, pressureB);
    swapPressure();

    gradientMaterial.uniforms.uVelocity.value = velocityA.texture;
    gradientMaterial.uniforms.uPressure.value = pressureA.texture;
    renderPass(gradientMaterial, velocityB);
    swapVelocity();

    renderer.setRenderTarget(null);
  }

  function update() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    compositeMaterial.uniforms.uTime.value += dt;

    if (!active && !pointer.pending) return;

    accumulator += dt;
    let steps = 0;
    const step = 1 / 120;
    while (accumulator >= step && steps < 8) {
      simulate(step);
      accumulator -= step;
      steps += 1;
    }

    if (!pointer.pending && now > activeUntil) {
      clearSimulation();
    }
  }

  function addPointerDelta(x, y, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (Math.hypot(dx, dy) < 0.00001) return;

    const maxDelta = 0.12;
    const length = Math.hypot(dx, dy);
    const scale = length > maxDelta ? maxDelta / length : 1;

    pointer.x = x;
    pointer.y = y;
    pointer.dx += dx * scale;
    pointer.dy += dy * scale;
    pointer.pending = true;
    active = true;
    activeUntil = performance.now() + 1800;
  }

  function resize(nextWidth, nextHeight) {
    rebuildTargets(nextWidth, nextHeight);
  }

  function dispose() {
    for (const target of [
      velocityA,
      velocityB,
      pressureA,
      pressureB,
      divergence,
    ]) {
      target?.dispose();
    }
    quad.geometry.dispose();
    for (const material of [
      clearMaterial,
      splatMaterial,
      advectionMaterial,
      divergenceMaterial,
      pressureMaterial,
      gradientMaterial,
      compositeMaterial,
    ]) {
      material.dispose();
    }
  }

  return {
    compositeMaterial,
    addPointerDelta,
    get active() {
      return active || pointer.pending;
    },
    get velocityTexture() {
      return velocityA?.texture || null;
    },
    resize,
    update,
    dispose,
  };
}
