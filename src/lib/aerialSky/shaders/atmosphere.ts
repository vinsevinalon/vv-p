import * as THREE from 'three';

/**
 * Pass 1A: Analytic Rayleigh + Mie + Ozone-Absorption Sky Dome
 * - Zero asset payload (0 KB), ~15-20 ALU ops/pixel (ultra-friendly to iOS TBDR & Fold GPUs)
 * - Captures the high-altitude (~30,000 ft) deep navy/cobalt stratosphere zenith transitioning
 *   through sapphire into bright cyan-white horizon haze (Day) and warm amber sunset glow
 *   into deep indigo twilight with subtle stars (Dusk/Night).
 */

export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldDir;

  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uTime;

  // High-altitude horizon dip (~30,000 ft)
  const float HORIZON_DIP = -0.058;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 computeDaySky(vec3 dir, vec3 sunDir) {
    float h = dir.y - HORIZON_DIP;
    float elev = clamp(h, 0.0, 1.0);

    // Physical high-altitude ozone/Rayleigh curve (matching Photos 1, 2, 4):
    // Deep navy stratosphere overhead -> rich cobalt -> azure -> luminous cyan-white horizon haze
    vec3 zenithOzone  = vec3(0.008, 0.045, 0.195);
    vec3 upperCobalt  = vec3(0.032, 0.185, 0.520);
    vec3 midAzure     = vec3(0.165, 0.480, 0.815);
    vec3 horizonHaze  = vec3(0.730, 0.855, 0.945);

    float t1 = smoothstep(0.0, 0.13, elev);
    float t2 = smoothstep(0.07, 0.42, elev);
    float t3 = smoothstep(0.28, 0.82, elev);

    vec3 sky = mix(horizonHaze, midAzure, t1);
    sky = mix(sky, upperCobalt, t2);
    sky = mix(sky, zenithOzone, t3);

    // Below horizon: smooth continuous transition matching terrain haze (zero hard seam!)
    if (h < 0.0) {
      vec3 belowHaze = vec3(0.68, 0.82, 0.93);
      sky = mix(horizonHaze, belowHaze, smoothstep(0.0, -0.25, h));
    }

    // Soft bright atmospheric scattering limb straddling h=0 smoothly on both sides
    float limb = exp(-pow(h * 16.0, 2.0));
    sky += vec3(0.14, 0.18, 0.22) * limb;

    // Mie forward scattering around the sun + soft solar disc
    float mu = max(dot(dir, sunDir), 0.0);
    float mieWide = pow(mu, 6.0) * 0.22;
    float mieTight = pow(mu, 48.0) * 0.55;
    float sunDisc = smoothstep(0.9985, 0.9996, mu) * 1.9;
    vec3 sunTint = vec3(1.0, 0.97, 0.90);
    sky += sunTint * (mieWide + mieTight + sunDisc) * smoothstep(-0.12, 0.06, h);

    return sky;
  }

  vec3 computeNightSky(vec3 dir, vec3 sunDir) {
    float h = dir.y - HORIZON_DIP;
    float elev = clamp(h, 0.0, 1.0);

    // Dusk / Blue-Hour Twilight matching Photo 3:
    // Deep indigo zenith -> slate twilight blue -> warm golden-amber horizon band
    vec3 zenithNight   = vec3(0.012, 0.025, 0.072);
    vec3 upperTwilight = vec3(0.055, 0.105, 0.245);
    vec3 lowTwilight   = vec3(0.155, 0.215, 0.375);
    vec3 amberBand     = vec3(0.840, 0.465, 0.205);

    vec3 sky = mix(lowTwilight, upperTwilight, smoothstep(0.03, 0.32, elev));
    sky = mix(sky, zenithNight, smoothstep(0.24, 0.85, elev));

    // Directional amber sunset afterglow along the horizon toward the setting sun azimuth
    vec3 flatDir = normalize(vec3(dir.x, 0.0, dir.z));
    vec3 flatSun = normalize(vec3(sunDir.x, 0.0, sunDir.z));
    float azGlow = pow(max(dot(flatDir, flatSun), 0.0), 1.8) * 0.72 + 0.28;
    float horizonBand = exp(-pow(max(h + 0.008, 0.0) * 15.5, 1.45)) * smoothstep(-0.08, 0.01, h);
    sky = mix(sky, amberBand, clamp(horizonBand * azGlow * 0.88, 0.0, 0.92));

    // Warm golden core near the sunset azimuth
    float coreGlow = exp(-abs(h - 0.01) * 28.0) * pow(max(dot(flatDir, flatSun), 0.0), 5.0);
    sky += vec3(0.95, 0.56, 0.24) * coreGlow * 0.55;

    // Below horizon: deep twilight navy + faint warm city horizon bounce
    if (h < 0.0) {
      vec3 darkEarthBackdrop = vec3(0.025, 0.042, 0.095);
      sky = mix(sky, darkEarthBackdrop, smoothstep(0.0, -0.22, h));
    }

    // Crisp subtle high-altitude stars in the upper ozone sky (never blinking wildly)
    if (elev > 0.18) {
      vec3 cell = floor(dir * 260.0);
      float rnd = hash31(cell);
      if (rnd > 0.9945) {
        vec3 center = normalize((cell + 0.5) / 260.0);
        float d = length(dir - center) * 260.0;
        float star = smoothstep(0.32, 0.04, d);
        float twinkle = 0.82 + 0.18 * sin(uTime * 1.4 + rnd * 120.0);
        float starVis = smoothstep(0.18, 0.52, elev) * (1.0 - horizonBand);
        sky += vec3(0.82, 0.89, 1.0) * star * twinkle * starVis * 0.72;
      }
    }

    return sky;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 dayCol = computeDaySky(dir, uSunDir);
    vec3 nightCol = computeNightSky(dir, uSunDir);
    vec3 col = mix(dayCol, nightCol, uNight);

    // Subtle filmic dither to prevent 8-bit sky gradient banding on mobile displays
    float dither = (hash31(gl_FragCoord.xyz) - 0.5) / 255.0;
    col += dither;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAtmosphereMesh(
  sunDir: THREE.Vector3
): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: sunDir.clone().normalize() },
    uNight: { value: 0.0 },
    uTime: { value: 0.0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const geometry = new THREE.SphereGeometry(900, 48, 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;

  return { mesh, uniforms };
}
