import * as THREE from 'three';

/**
 * Generates lightweight tileable procedural textures on startup (~40-70ms, 0 KB download):
 * 1. 64^3 RGBA 3D Perlin-Worley cloud shape & erosion volume
 * 2. 256x256 RGBA 2D weather map (R: cumulus coverage, G: turret height, B: stratus, A: cirrus)
 * 3. 64x64 single-channel blue-noise-like jitter map for banding-free low-step raymarching
 */

function fract(x: number): number {
  return x - Math.floor(x);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash3(x: number, y: number, z: number, period: number, seed: number): number {
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  const pz = ((z % period) + period) % period;
  const n = Math.sin(px * 127.1 + py * 311.7 + pz * 74.7 + seed * 19.19) * 43758.5453123;
  return fract(n);
}

function hash2(x: number, y: number, period: number, seed: number): number {
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  const n = Math.sin(px * 127.1 + py * 311.7 + seed * 43.37) * 43758.5453123;
  return fract(n);
}

function tileableValue3D(x: number, y: number, z: number, freq: number, seed: number): number {
  const gx = x * freq;
  const gy = y * freq;
  const gz = z * freq;

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);

  const fx = fade(gx - x0);
  const fy = fade(gy - y0);
  const fz = fade(gz - z0);

  const c000 = hash3(x0, y0, z0, freq, seed);
  const c100 = hash3(x0 + 1, y0, z0, freq, seed);
  const c010 = hash3(x0, y0 + 1, z0, freq, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, freq, seed);
  const c001 = hash3(x0, y0, z0 + 1, freq, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, freq, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, freq, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, freq, seed);

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);

  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

function tileableWorley3D(x: number, y: number, z: number, freq: number, seed: number): number {
  const gx = x * freq;
  const gy = y * freq;
  const gz = z * freq;

  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const iz = Math.floor(gz);

  let minDistSq = 1.8;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const ox = hash3(cx, cy, cz, freq, seed + 1.1);
        const oy = hash3(cx, cy, cz, freq, seed + 7.3);
        const oz = hash3(cx, cy, cz, freq, seed + 13.7);

        const rx = cx + ox - gx;
        const ry = cy + oy - gy;
        const rz = cz + oz - gz;
        const d2 = rx * rx + ry * ry + rz * rz;
        if (d2 < minDistSq) minDistSq = d2;
      }
    }
  }
  return Math.max(0, Math.min(1, 1.0 - Math.sqrt(minDistSq)));
}

function tileableFbm2D(x: number, y: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;

  for (let i = 0; i < octaves; i++) {
    const gx = x * freq;
    const gy = y * freq;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = fade(gx - x0);
    const fy = fade(gy - y0);

    const a = hash2(x0, y0, freq, seed + i * 17.3);
    const b = hash2(x0 + 1, y0, freq, seed + i * 17.3);
    const c = hash2(x0, y0 + 1, freq, seed + i * 17.3);
    const d = hash2(x0 + 1, y0 + 1, freq, seed + i * 17.3);

    const v = lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    sum += v * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function tileableWorley2D(x: number, y: number, freq: number, seed: number): number {
  const gx = x * freq;
  const gy = y * freq;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let minD2 = 2.0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const ox = hash2(cx, cy, freq, seed + 2.3);
      const oy = hash2(cx, cy, freq, seed + 9.7);
      const rx = cx + ox - gx;
      const ry = cy + oy - gy;
      const d2 = rx * rx + ry * ry;
      if (d2 < minD2) minD2 = d2;
    }
  }
  return Math.max(0, Math.min(1, 1.0 - Math.sqrt(minD2)));
}

export interface ProceduralCloudMaps {
  volumeTexture: THREE.Data3DTexture;
  weatherTexture: THREE.DataTexture;
  weatherData: Uint8Array;
  weatherSize: number;
  jitterTexture: THREE.DataTexture;
}

export function createProceduralCloudMaps(volumeSize = 48, weatherSize = 256): ProceduralCloudMaps {
  // 1. 3D Cloud Noise Volume (48^3 = ~442 KB VRAM, builds in ~35ms on mobile & desktop)
  const volData = new Uint8Array(volumeSize * volumeSize * volumeSize * 4);
  let idx = 0;

  for (let z = 0; z < volumeSize; z++) {
    const nz = z / volumeSize;
    for (let y = 0; y < volumeSize; y++) {
      const ny = y / volumeSize;
      for (let x = 0; x < volumeSize; x++) {
        const nx = x / volumeSize;

        // Perlin-like fBm + inverted Worley for puffy billowing cumulus lobes
        const p0 = tileableValue3D(nx, ny, nz, 4, 1.0);
        const p1 = tileableValue3D(nx, ny, nz, 8, 2.0);
        const p2 = tileableValue3D(nx, ny, nz, 16, 3.0);
        const perlin = p0 * 0.57 + p1 * 0.29 + p2 * 0.14;

        const w1 = tileableWorley3D(nx, ny, nz, 4, 11.0);
        const w2 = tileableWorley3D(nx, ny, nz, 8, 23.0);
        const w3 = tileableWorley3D(nx, ny, nz, 12, 37.0);

        // Perlin-Worley blend for primary billowy silhouette
        const pw = Math.max(0, Math.min(1, lerp(perlin, w1, 0.55) * 1.15 - 0.08));

        volData[idx++] = Math.round(pw * 255);
        volData[idx++] = Math.round(w1 * 255);
        volData[idx++] = Math.round(w2 * 255);
        volData[idx++] = Math.round(w3 * 255);
      }
    }
  }

  const volumeTexture = new THREE.Data3DTexture(volData, volumeSize, volumeSize, volumeSize);
  volumeTexture.format = THREE.RGBAFormat;
  volumeTexture.type = THREE.UnsignedByteType;
  volumeTexture.minFilter = THREE.LinearFilter;
  volumeTexture.magFilter = THREE.LinearFilter;
  volumeTexture.wrapS = THREE.RepeatWrapping;
  volumeTexture.wrapT = THREE.RepeatWrapping;
  volumeTexture.wrapR = THREE.RepeatWrapping;
  volumeTexture.unpackAlignment = 1;
  volumeTexture.needsUpdate = true;

  // 2. 2D Weather Map (256x256)
  // Designed so dense cumulus fields have realistic clearings where land/city lights shine through,
  // plus occasional tall cumulus turrets (G channel) that reach near cruise altitude for close passes!
  const weatherData = new Uint8Array(weatherSize * weatherSize * 4);
  let wIdx = 0;

  for (let y = 0; y < weatherSize; y++) {
    const ny = y / weatherSize;
    for (let x = 0; x < weatherSize; x++) {
      const nx = x / weatherSize;

      // Domain warp slightly for organic wind-sculpted cloud streets
      const wx = fract(nx + (tileableFbm2D(nx, ny, 3, 2, 5.0) - 0.5) * 0.16);
      const wy = fract(ny + (tileableFbm2D(nx, ny, 3, 2, 9.0) - 0.5) * 0.16);

      const macro = tileableFbm2D(wx, wy, 3, 4, 14.0);
      const cells = tileableWorley2D(wx, wy, 6, 31.0);
      const fine = tileableFbm2D(wx, wy, 10, 3, 47.0);

      // R: Rich billowing cumulus banks (~52-60% coverage with dramatic sunlit corridors revealing land & cities)
      let coverage = macro * 0.62 + cells * 0.28 + fine * 0.16;
      coverage = Math.max(0, Math.min(1, (coverage - 0.30) * 1.88));

      // G: Towering cauliflower turret height (Photos 1 & 2)
      const turretSeed = tileableWorley2D(wx, wy, 5, 71.0) * 0.65 + macro * 0.35;
      const height = Math.max(0, Math.min(1, Math.pow(Math.max(0, turretSeed - 0.16) * 1.38, 1.25)));

      // B: Crisp smaller cumulus puffs scattered across the clear openings over farmland/cities
      const lowPuffs = Math.max(0, Math.min(1, (tileableWorley2D(nx, ny, 9, 89.0) * 0.74 + fine * 0.26 - 0.44) * 2.25));

      // A: High wispy cirrus streaks (stretched along wind axis)
      const cx = fract(nx + (tileableFbm2D(nx, ny, 2, 2, 103.0) - 0.5) * 0.22);
      const cy = fract(ny * 2.0);
      const cirrusRaw = tileableFbm2D(cx, cy, 4, 4, 117.0);
      const cirrus = Math.max(0, Math.min(1, Math.pow(Math.max(0, cirrusRaw - 0.44) * 2.2, 1.5)));

      weatherData[wIdx++] = Math.round(coverage * 255);
      weatherData[wIdx++] = Math.round(height * 255);
      weatherData[wIdx++] = Math.round(lowPuffs * 255);
      weatherData[wIdx++] = Math.round(cirrus * 255);
    }
  }

  const weatherTexture = new THREE.DataTexture(weatherData, weatherSize, weatherSize, THREE.RGBAFormat);
  weatherTexture.wrapS = THREE.RepeatWrapping;
  weatherTexture.wrapT = THREE.RepeatWrapping;
  weatherTexture.minFilter = THREE.LinearFilter;
  weatherTexture.magFilter = THREE.LinearFilter;
  weatherTexture.needsUpdate = true;

  // 3. 64x64 Interleaved Gradient / Blue-Noise-Like Jitter Texture
  const jSize = 64;
  const jData = new Uint8Array(jSize * jSize * 4);
  let jIdx = 0;
  for (let y = 0; y < jSize; y++) {
    for (let x = 0; x < jSize; x++) {
      // Interleaved Gradient Noise (Jorge Jimenez) — ideal for low-step volumetric dithering
      const ign = fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
      const v = Math.round(ign * 255);
      jData[jIdx++] = v;
      jData[jIdx++] = v;
      jData[jIdx++] = v;
      jData[jIdx++] = 255;
    }
  }
  const jitterTexture = new THREE.DataTexture(jData, jSize, jSize, THREE.RGBAFormat);
  jitterTexture.wrapS = THREE.RepeatWrapping;
  jitterTexture.wrapT = THREE.RepeatWrapping;
  jitterTexture.minFilter = THREE.NearestFilter;
  jitterTexture.magFilter = THREE.NearestFilter;
  jitterTexture.needsUpdate = true;

  return {
    volumeTexture,
    weatherTexture,
    weatherData,
    weatherSize,
    jitterTexture,
  };
}
