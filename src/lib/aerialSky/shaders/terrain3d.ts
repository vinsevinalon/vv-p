import * as THREE from 'three';

/**
 * Option B — True 3D Displaced Relief Earth Terrain
 * Replaces the flat decal plane with real 3D vertex-displaced ridges, mesas, and valleys
 * moving seamlessly beneath the camera at ~30,000 ft:
 * - World-space multi-octave heightfield creates genuine 3D parallax & sunlit/shadowed mountain slopes
 * - Real NASA ISS farmland/basin photography (Day) + NASA ISS glowing city grid (Night)
 * - Texture-derived micro-bump normals add crisp sunlit surface relief
 * - Real-time moving cloud shadows projected across 3D valleys and ridges
 * - At night, glowing golden city arteries nestle in the valleys while 3D ridges stay dark silhouettes
 */

export const TERRAIN3D_VERTEX_SHADER = /* glsl */ `
  uniform vec2 uFlightOffset;
  uniform float uTerrainRelief;

  varying vec3 vWorldPos;
  varying vec2 vScrollXZ;
  varying vec3 vNormal3D;
  varying float vElev;
  varying float vHorizDist;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Realistic macro relief: broad flat agricultural valleys punctuated by crisp ridged mountain chains
  float evalHeight(vec2 xz) {
    vec2 p = xz * 0.0085;
    float basin = vnoise(p * 0.55);
    // Ridged multifractal for realistic mountain spines
    float r1 = 1.0 - abs(vnoise(p * 1.15 + 3.1) * 2.0 - 1.0);
    float r2 = 1.0 - abs(vnoise(p * 2.45 + 7.7) * 2.0 - 1.0);
    float r3 = 1.0 - abs(vnoise(p * 5.10 + 13.4) * 2.0 - 1.0);
    float ridge = r1 * r1 * 0.62 + r2 * r2 * 0.28 + r3 * r3 * 0.10;

    // Keep ~55% of land as flat sunlit farmland/city valleys, ~45% rising into gentle FL300 3D ridges
    // Max elevation (~7.5 units -> y=-50.5) stays cleanly below the lower cloud deck (y=-46) with zero self-overlap!
    float mountainMask = smoothstep(0.46, 0.78, basin);
    float hills = vnoise(p * 1.8) * 1.1;
    return (hills + ridge * mountainMask * 7.2) * uTerrainRelief;
  }

  void main() {
    vec3 pos = position;
    vHorizDist = length(pos.xz);

    // Taper relief gently near extreme horizon so Earth rim dissolves cleanly into haze
    float reliefFade = 1.0 - smoothstep(420.0, 740.0, vHorizDist);
    vec2 scrollXZ = pos.xz + uFlightOffset * 0.46;

    float hC = evalHeight(scrollXZ) * reliefFade;
    float eps = 3.5;
    float hX = evalHeight(scrollXZ + vec2(eps, 0.0)) * reliefFade;
    float hZ = evalHeight(scrollXZ + vec2(0.0, eps)) * reliefFade;

    pos.y += hC;

    vec3 n = normalize(vec3(hC - hX, eps, hC - hZ));

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vScrollXZ = scrollXZ;
    vNormal3D = n;
    vElev = hC;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const TERRAIN3D_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPos;
  varying vec2 vScrollXZ;
  varying vec3 vNormal3D;
  varying float vElev;
  varying float vHorizDist;

  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uShadowMap;
  uniform vec2 uFlightOffset;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uHasDayTex;
  uniform float uHasNightTex;

  const float TILE_SCALE = 0.0056;
  const float SHADOW_SCALE = 0.0028;

  vec3 sampleDayAerial(vec2 xz, out vec3 bumpN) {
    vec2 uvA = xz * TILE_SCALE;
    vec2 uvB = (xz * mat2(0.866, -0.5, 0.5, 0.866)) * (TILE_SCALE * 0.41);

    if (uHasDayTex < 0.5) {
      bumpN = vec3(0.0, 1.0, 0.0);
      return vec3(0.42, 0.40, 0.34);
    }

    vec3 tA = texture2D(uDayMap, uvA).rgb;
    vec3 tB = texture2D(uDayMap, uvB).rgb;

    // Derive crisp photographic micro-relief normal from neighboring texels
    float texEps = 0.0022;
    float lC = dot(tA, vec3(0.299, 0.587, 0.114));
    float lX = dot(texture2D(uDayMap, uvA + vec2(texEps, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lZ = dot(texture2D(uDayMap, uvA + vec2(0.0, texEps)).rgb, vec3(0.299, 0.587, 0.114));
    bumpN = normalize(vec3((lC - lX) * 2.6, 1.0, (lC - lZ) * 2.6));

    float lumaB = dot(tB, vec3(0.299, 0.587, 0.114));
    vec3 col = tA * mix(0.84, 1.16, lumaB);

    // Rich high-altitude earth saturation (terracotta basins, olive crops, sandy ridges)
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 1.24);
    col = pow(max(col, vec3(0.001)), vec3(1.04)) * vec3(1.06, 1.02, 0.96);

    // High 3D mountain ridges pick up rocky slate & sunlit snow-dusted crests (Photo 4)
    float rockMask = smoothstep(2.8, 5.8, vElev);
    float snowMask = smoothstep(5.2, 7.6, vElev) * smoothstep(0.55, 0.92, vNormal3D.y);
    vec3 rockCol = vec3(0.36, 0.34, 0.33);
    vec3 snowCol = vec3(0.92, 0.95, 0.99);
    col = mix(col, rockCol, rockMask * 0.62);
    col = mix(col, snowCol, snowMask * 0.78);

    return col;
  }

  vec3 sampleNightAerial(vec2 xz) {
    vec2 uvA = xz * (TILE_SCALE * 0.85);
    vec2 uvB = (xz * mat2(0.8, 0.6, -0.6, 0.8)) * (TILE_SCALE * 0.36);

    if (uHasNightTex < 0.5) {
      return vec3(0.014, 0.024, 0.056);
    }

    vec3 nA = texture2D(uNightMap, uvA).rgb;
    vec3 nB = texture2D(uNightMap, uvB).rgb;

    float cluster = smoothstep(0.04, 0.38, dot(nB, vec3(0.333)));
    vec3 lights = nA * (0.78 + 0.85 * cluster) + nB * 0.36;

    // Cities glow brightly in flat valleys & foothills, fading naturally on high 3D mountain peaks!
    float valleyMask = 1.0 - smoothstep(2.4, 5.6, vElev);
    float lum = dot(lights, vec3(0.30, 0.59, 0.11)) * valleyMask;
    float roadPunch = pow(clamp(lum * 1.75, 0.0, 1.0), 1.18);
    float hotCore = smoothstep(0.52, 0.95, roadPunch);

    vec3 warmGold = mix(vec3(1.0, 0.50, 0.12), vec3(1.0, 0.88, 0.56), smoothstep(0.15, 0.85, roadPunch));
    warmGold = mix(warmGold, vec3(1.0, 0.97, 0.86), hotCore * 0.65);

    // Subtle twilight blue skylight on 3D mountain slopes at night
    float slopeLight = max(dot(normalize(vNormal3D), normalize(vec3(uSunDir.x, 0.35, uSunDir.z))), 0.0);
    vec3 darkLand = vec3(0.012, 0.022, 0.054) + vec3(0.022, 0.036, 0.072) * slopeLight;

    return darkLand + warmGold * roadPunch * 2.5;
  }

  void main() {
    vec3 viewVec = vWorldPos - cameraPosition;
    float dist = length(viewVec);
    vec3 viewDir = viewVec / max(dist, 0.0001);

    vec3 bumpN;
    vec3 dayBase = sampleDayAerial(vScrollXZ, bumpN);
    vec3 nightBase = sampleNightAerial(vScrollXZ);

    // Combine true 3D geometric mountain normal + photographic micro-bump normal
    vec3 N = normalize(vec3(
      vNormal3D.x + bumpN.x * 0.28,
      vNormal3D.y,
      vNormal3D.z + bumpN.z * 0.28
    ));

    // Directional 3D slope shading (makes mountain ridges & valleys unmistakably 3D!)
    float ndl = max(dot(N, uSunDir), 0.0);
    float sunShade = mix(0.42, 1.24, smoothstep(0.0, 0.85, ndl));
    vec3 slopeTint = mix(vec3(0.64, 0.75, 0.92), vec3(1.06, 1.03, 0.97), smoothstep(0.08, 0.72, ndl));

    // Real-time projected moving cloud shadows across the 3D terrain (Photos 1 & 2)
    vec2 sunProj = uSunDir.xz / max(uSunDir.y, 0.30);
    vec2 shadowXZ = vWorldPos.xz + uFlightOffset + sunProj * 26.0;
    float cloudMask = texture2D(uShadowMap, shadowXZ * SHADOW_SCALE).r;
    float dayShadow = 1.0 - smoothstep(0.24, 0.76, cloudMask) * 0.62;
    vec3 shadowCol = mix(vec3(0.36, 0.48, 0.68), vec3(1.0), dayShadow);

    vec3 dayLit = dayBase * sunShade * slopeTint * shadowCol;

    // Nighttime: clouds slightly soften city lights beneath them
    float nightCloudAtten = 1.0 - smoothstep(0.32, 0.84, cloudMask) * 0.38;
    vec3 nightLit = nightBase * nightCloudAtten;

    vec3 groundCol = mix(dayLit, nightLit, uNight);

    // Physical high-altitude aerial perspective haze blending seamlessly into Layer 1 horizon
    float hazeFactor = smoothstep(95.0, 620.0, vHorizDist);
    float edgeFade = smoothstep(540.0, 770.0, vHorizDist);

    vec3 dayHaze = vec3(0.73, 0.86, 0.95);
    vec3 flatDir = normalize(vec3(viewDir.x, 0.0, viewDir.z));
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    float azGlow = pow(max(dot(flatDir, flatSun), 0.0), 1.8) * 0.65 + 0.35;
    vec3 nightHaze = mix(vec3(0.10, 0.16, 0.31), vec3(0.76, 0.44, 0.21), azGlow * 0.68);
    vec3 hazeCol = mix(dayHaze, nightHaze, uNight);

    // Distance haze lifts shadows slightly just like real Rayleigh air column scattering
    groundCol = mix(groundCol, hazeCol, clamp(hazeFactor * mix(0.95, 0.84, uNight), 0.0, 0.98));

    float alpha = 1.0 - edgeFade;
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(groundCol, alpha);
  }
`;

export function createReliefTerrainMesh(
  shadowTexture: THREE.Texture,
  sunDir: THREE.Vector3
): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const radius = 780;
  const rings = 88;
  const segments = 128;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const baseAltitude = -58.0;
  const earthCurveDrop = 0.000038;

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    // Denser vertices beneath & mid-distance for crisp 3D mountain silhouettes
    const dist = radius * Math.pow(t, 1.75);
    const y = baseAltitude - dist * dist * earthCurveDrop;

    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      positions.push(x, y, z);
      uvs.push(x / radius, z / radius);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + 1;
      const c = (r + 1) * stride + s;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const dummy = new THREE.DataTexture(new Uint8Array([120, 128, 110, 255]), 1, 1);
  dummy.needsUpdate = true;

  const uniforms: Record<string, THREE.IUniform> = {
    uDayMap: { value: dummy },
    uNightMap: { value: dummy },
    uShadowMap: { value: shadowTexture },
    uFlightOffset: { value: new THREE.Vector2(0, 0) },
    uSunDir: { value: sunDir.clone().normalize() },
    uNight: { value: 0.0 },
    uTerrainRelief: { value: 1.0 },
    uHasDayTex: { value: 0.0 },
    uHasNightTex: { value: 0.0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: TERRAIN3D_VERTEX_SHADER,
    fragmentShader: TERRAIN3D_FRAGMENT_SHADER,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;

  return { mesh, uniforms };
}
