/// <reference types="vite/client" />

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import basisTranscoder from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import basisWasm from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import { AerialCameraRig } from './cameraRig';
import { createProceduralCloudMaps } from './noiseVolume';
import { createAtmosphereMesh } from './shaders/atmosphere';
import { createReliefTerrainMesh } from './shaders/terrain3d';
import {
  createVaporCloudField,
  FLIGHT_DIR_XZ,
  PHOTO_MIST_ASSET_NAMES,
} from './shaders/vaporCloudField';
import type { SkyTheme } from '../skyBridge';

interface AerialSkyOptions {
  initialTheme: SkyTheme;
  onProgress: (progress: number) => void;
}

function isMobileOrFoldable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

export function createAerialSky(
  container: HTMLElement,
  options: AerialSkyOptions,
) {
  let targetNight = options.initialTheme === 'dark' ? 1.0 : 0.0;
  let currentNight = targetNight;

  let reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const isMobile = isMobileOrFoldable();
  const maxDpr = isMobile ? 1.5 : 2.0;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    depth: false,
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const daySunDir = new THREE.Vector3(0.46, 0.44, -0.77).normalize();
  const nightSunDir = new THREE.Vector3(0.22, -0.02, -0.97).normalize();
  const activeSunDir = daySunDir.clone().lerp(nightSunDir, currentNight).normalize();

  const shadowMaps = createProceduralCloudMaps(16, 256);

  const scene = new THREE.Scene();
  const atmosphere = createAtmosphereMesh(activeSunDir);
  const terrain3d = createReliefTerrainMesh(shadowMaps.weatherTexture, activeSunDir);
  const cloudField = createVaporCloudField(activeSunDir);

  scene.add(atmosphere.mesh);
  scene.add(terrain3d.mesh);
  scene.add(cloudField.cirrusMesh);
  scene.add(cloudField.group);
  scene.add(cloudField.smokeMesh);

  const rig = new AerialCameraRig();

  let resizeTimer: number | null = null;
  let contextLost = false;
  let disposed = false;

  function applyResize(immediate = false) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    rig.resize(w, h, immediate);
  }

  applyResize(true);

  const resizeObserver = new ResizeObserver(() => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    rig.resize(w, h, false);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      if (!disposed) applyResize(false);
    }, 100);
  });
  resizeObserver.observe(container);

  const onContextLost = (ev: Event) => {
    ev.preventDefault();
    contextLost = true;
  };
  const onContextRestored = () => {
    contextLost = false;
    applyResize(true);
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // Load the photographic clouds and terrain before upgrading the terrain compression.
  let dayTexRef: THREE.Texture | null = null;
  let nightTexRef: THREE.Texture | null = null;
  const cloudTexRefs: THREE.Texture[] = [];

  function configureGroundTexture(tex: THREE.Texture) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
  }

  async function loadAllAssets() {
    const texLoader = new THREE.TextureLoader();
    const urls = [
      ...PHOTO_MIST_ASSET_NAMES.map((name) => `/aerial-sky/clouds/${name}.webp`),
      '/aerial-sky/textures/terrain-day.webp',
      '/aerial-sky/textures/terrain-night.webp',
    ];
    let settled = 0;
    const textures = await Promise.allSettled(urls.map((url) =>
      texLoader.loadAsync(url).finally(() => {
        settled++;
        if (!disposed) options.onProgress(settled / urls.length);
      }),
    ));

    if (!disposed && textures.every((result) => result.status === 'fulfilled')) {
      const loaded = textures.map((result) => result.value);
      const dayWebp = loaded[PHOTO_MIST_ASSET_NAMES.length];
      const nightWebp = loaded[PHOTO_MIST_ASSET_NAMES.length + 1];
      const loadedClouds = loaded.slice(0, PHOTO_MIST_ASSET_NAMES.length);

      for (const texture of loadedClouds) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
      }
      cloudTexRefs.push(...loadedClouds);
      cloudField.setTextures(loadedClouds);

      configureGroundTexture(dayWebp);
      configureGroundTexture(nightWebp);
      dayTexRef = dayWebp;
      nightTexRef = nightWebp;
      terrain3d.uniforms.uDayMap.value = dayWebp;
      terrain3d.uniforms.uNightMap.value = nightWebp;
      terrain3d.uniforms.uHasDayTex.value = 1.0;
      terrain3d.uniforms.uHasNightTex.value = 1.0;
    } else {
      for (const result of textures) {
        if (result.status === 'fulfilled') result.value.dispose();
      }
    }
    if (disposed) return;

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url === 'basis_transcoder.js') return basisTranscoder;
      if (url === 'basis_transcoder.wasm') return basisWasm;
      return url;
    });
    const ktx2Loader = new KTX2Loader(manager);
    ktx2Loader.setWorkerLimit(2);
    try {
      ktx2Loader.detectSupport(renderer);
      const results = await Promise.allSettled([
        ktx2Loader.loadAsync('/aerial-sky/textures/terrain-day.ktx2'),
        ktx2Loader.loadAsync('/aerial-sky/textures/terrain-night.ktx2'),
      ]);
      const loaded = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      if (disposed || loaded.length !== results.length) {
        loaded.forEach((texture) => texture.dispose());
        return;
      }
      const [dayKtx, nightKtx] = loaded;
      configureGroundTexture(dayKtx);
      configureGroundTexture(nightKtx);
      const oldDay = dayTexRef;
      const oldNight = nightTexRef;
      dayTexRef = dayKtx;
      nightTexRef = nightKtx;
      terrain3d.uniforms.uDayMap.value = dayKtx;
      terrain3d.uniforms.uNightMap.value = nightKtx;
      terrain3d.uniforms.uHasDayTex.value = 1.0;
      terrain3d.uniforms.uHasNightTex.value = 1.0;
      oldDay?.dispose();
      oldNight?.dispose();
    } catch {
      // Keep WebP cleanly
    } finally {
      ktx2Loader.dispose();
    }
  }

  void loadAllAssets();

  // Unified physical flight travel along FLIGHT_DIR_XZ (terrain & all cloud shelves locked together!)
  let flightTravel = 0;
  const flightOffset2D = new THREE.Vector2(0, 0);
  let elapsedTime = 0;
  let lastNow = performance.now();
  let rafId: number | null = null;
  let isHidden = document.hidden;

  const onVisibilityChange = () => {
    isHidden = document.hidden;
    if (!isHidden && !disposed) {
      lastNow = performance.now();
      scheduleFrame();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const reducedMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onReducedMotionChange = (ev: MediaQueryListEvent) => {
    reducedMotion = ev.matches;
  };
  reducedMotionMedia?.addEventListener?.('change', onReducedMotionChange);

  function scheduleFrame() {
    if (rafId !== null || disposed || isHidden) return;
    rafId = window.requestAnimationFrame(tick);
  }

  function tick(now: number) {
    rafId = null;
    if (disposed || isHidden) return;

    const rawDtMs = now - lastNow;
    lastNow = now;
    const dt = Math.min(Math.max(rawDtMs / 1000, 0.001), 0.05);

    if (!contextLost) {
      const nightSmooth = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.8);
      currentNight = THREE.MathUtils.lerp(currentNight, targetNight, nightSmooth);
      if (Math.abs(currentNight - targetNight) < 0.001) currentNight = targetNight;

      activeSunDir.copy(daySunDir).lerp(nightSunDir, currentNight).normalize();

      elapsedTime += dt;

      // Single unified physical airspeed (26 units/s) drives BOTH 3D land and every cloud shelf!
      flightTravel += dt * 26.0;
      flightOffset2D.set(
        FLIGHT_DIR_XZ.x * flightTravel,
        FLIGHT_DIR_XZ.y * flightTravel
      );

      // Subtle FL300 living-airframe float + micro air-pocket buffeting when punching through a cloud!
      const baseHeave = reducedMotion
        ? 0
        : Math.sin(elapsedTime * 0.72) * 0.22 + Math.sin(elapsedTime * 0.41 + 1.3) * 0.14;
      rig.camera.position.set(0, baseHeave, 0);

      rig.update(dt, reducedMotion);

      atmosphere.uniforms.uSunDir.value.copy(activeSunDir);
      atmosphere.uniforms.uNight.value = currentNight;
      atmosphere.uniforms.uTime.value = elapsedTime;

      terrain3d.uniforms.uSunDir.value.copy(activeSunDir);
      terrain3d.uniforms.uNight.value = currentNight;
      terrain3d.uniforms.uFlightOffset.value.set(
        flightOffset2D.x * 2.174,
        flightOffset2D.y * 2.174
      );

      const { immersion } = cloudField.update(
        rig.camera,
        flightTravel,
        flightOffset2D,
        activeSunDir,
        currentNight,
        elapsedTime,
        dt
      );

      // Calm, weighty buoyant drift when gliding through dense cloud vapor (zero high-frequency jitter!)
      if (!reducedMotion && immersion > 0.01) {
        const gentleSwell = Math.sin(elapsedTime * 1.15) * 0.16 * immersion;
        rig.camera.position.set(0, baseHeave + gentleSwell, 0);
      }

      renderer.render(scene, rig.camera);
    }

    scheduleFrame();
  }

  scheduleFrame();

  return {
    setTheme(next: SkyTheme) {
      targetNight = next === 'dark' ? 1.0 : 0.0;
    },
    requestGyroPermission() {
      if (rig.getGyroStatus() === 'needs-permission') {
        void rig.requestGyroPermission();
      }
    },
    dispose() {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotionMedia?.removeEventListener?.('change', onReducedMotionChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);

      rig.dispose();
      cloudField.dispose();
      shadowMaps.volumeTexture.dispose();
      shadowMaps.weatherTexture.dispose();
      shadowMaps.jitterTexture.dispose();
      dayTexRef?.dispose();
      nightTexRef?.dispose();
      cloudTexRefs.forEach((t) => t.dispose());

      atmosphere.mesh.geometry.dispose();
      (atmosphere.mesh.material as THREE.Material).dispose();
      terrain3d.mesh.geometry.dispose();
      (terrain3d.mesh.material as THREE.Material).dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
