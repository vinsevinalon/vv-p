import * as THREE from 'three';

/**
 * 12-Volume Photo-Mist 3D Cloud System + True-to-Life Volumetric Thick-Smoke Pass-Through:
 *
 * 1. Zero-Flicker Aerodynamic Pass-Through Physics:
 *    - Strictly constant per-cloud flow rates (zero `uTime * vPassProx` phase-jump strobing!)
 *    - Zero high-frequency vertex flutter or oscillating UV wobble
 *    - Sign-locked lateral bow-wave parting (`passSide` fixed at spawn -> zero centerline flips!)
 *    - Wide silky near-plane dissolve on Shelf 3 (`18..56` units) handing off seamlessly into a
 *      dedicated fullscreen Volumetric Thick-Smoke Immersion Pass
 * 2. Fullscreen Volumetric Thick-Smoke Immersion Shader (`smokeMesh`):
 *    - Driven by ONE continuous, exponentially damped cluster-level immersion envelope (`0..1`)
 *      with monotonically integrated radial optical flow (`uSmokeTravel`) so thick billowing cloud
 *      vapor continuously parts outward from center toward all screen edges—like gliding smoothly
 *      through real dense smoke/cloud!
 *    - Physically graded for BOTH Day (luminous sunlit white-silver + forward Mie sun glow) and
 *      Night (deep twilight indigo-periwinkle + warm amber horizon + soft golden city scatter below)
 *    - Zero GPU cost in clear air (`smokeMesh.visible = false` when `immersion < 0.002`)
 * 3. Sculpted 3D Lower Cloud Clusters (Shelf 1) + Beer-Lambert Optical Transmittance
 */

const VAPOR_CLOUD_VERTEX = /* glsl */ `
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uFlightDir;       // Unit world-space flight direction on XZ plane
  uniform vec3 uCenterWorld;
  uniform vec2 uSize;
  uniform float uFlipX;
  uniform float uRoll;
  uniform float uGroundAlign;    // 0.0 = billboard, 0.22..0.48 = orthonormal 3D tilted lower cloud deck
  uniform float uPassProximity;  // 0.0 far -> 1.0 gliding close past aircraft
  uniform float uSideSign;       // Sign-locked at spawn (+1 right, -1 left -> never flips!)
  uniform vec3 uPartDir;         // Smooth outward radial parting direction
  uniform float uSeed;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vCamDist;
  varying float vPassProx;
  varying vec3 vAxisX;
  varying vec3 vAxisY;

  void main() {
    // 1. Guaranteed-orthonormal 360°-safe camera-to-horizontal tilt basis
    vec3 camBack = cross(uCamRight, uCamUp);
    vec3 fwdHoriz = vec3(-camBack.x, 0.0, -camBack.z);
    float fhLen = length(fwdHoriz);
    fwdHoriz = fhLen > 0.001 ? (fwdHoriz / fhLen) : uFlightDir;
    vec3 rightHoriz = normalize(cross(fwdHoriz, vec3(0.0, 1.0, 0.0)));

    vec3 baseX = normalize(mix(uCamRight, rightHoriz, uGroundAlign));
    vec3 rawY = mix(uCamUp, fwdHoriz, uGroundAlign);
    vec3 baseY = rawY - baseX * dot(rawY, baseX);
    baseY = length(baseY) > 0.001 ? normalize(baseY) : uCamUp;

    float c = cos(uRoll);
    float s = sin(uRoll);
    vec3 axisX = baseX * c - baseY * s;
    vec3 axisY = baseX * s + baseY * c;

    // 2. Smooth, strictly monotonic aerodynamic bow-wave parting (zero oscillation or flutter!)
    vec2 localQuad = position.xy;
    float radialOut = length(localQuad);
    float proxSmooth = uPassProximity * uPassProximity * (3.0 - 2.0 * uPassProximity);
    float partExpand = 1.0 + proxSmooth * (0.28 + radialOut * 0.20);

    // Gentle convex slipstream sweep backward along -uFlightDir so peripheral mist glides smoothly past
    float bowCurve = (1.0 - smoothstep(0.0, 0.80, radialOut)) * 6.0 * proxSmooth;
    float sideSweep = clamp(-localQuad.x * uSideSign, -0.5, 0.5) * 8.0 * proxSmooth;
    vec3 aeroDepthCurve = -uFlightDir * (bowCurve + sideSweep);

    vec3 slipstreamPush = uPartDir * (proxSmooth * 9.5) + aeroDepthCurve;

    vec3 worldPos = uCenterWorld
                  + slipstreamPush
                  + axisX * (localQuad.x * uSize.x * partExpand)
                  + axisY * (localQuad.y * uSize.y * partExpand);

    vUv = vec2(uFlipX > 0.5 ? (1.0 - uv.x) : uv.x, uv.y);
    vWorldPos = worldPos;
    vCamDist = length(worldPos - cameraPosition);
    vPassProx = proxSmooth;
    vAxisX = axisX;
    vAxisY = axisY;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const VAPOR_CLOUD_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uOpacity;
  uniform float uOpticalDepth;
  uniform float uWispiness;
  uniform float uLifecycleAlpha;
  uniform float uFlowAmount;
  uniform float uFlowDir;
  uniform float uShadeBias;
  uniform vec2 uNearFadeRange;   // (minDist, maxDist) — wider on Shelf 3 so quads dissolve invisibly into thick smoke!
  uniform float uTime;
  uniform float uSeed;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vCamDist;
  varying float vPassProx;
  varying vec3 vAxisX;
  varying vec3 vAxisY;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.53);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  vec2 evalFlowField(vec2 uv, float seed) {
    vec2 p = uv * 2.5 + vec2(seed * 1.73, seed * 2.41);
    float n1 = vnoise(p);
    float n2 = vnoise(p * 1.85 + vec2(4.7, 2.3));
    float fx = (0.65 + 0.50 * (n1 - 0.5)) * uFlowDir;
    float fy = (0.24 + 0.58 * (n2 - 0.5));
    return vec2(fx, fy);
  }

  void main() {
    if (uLifecycleAlpha < 0.003) discard;

    // Early silky near-fade cull so close clouds never clip or flash at the lens
    float nearFade = smoothstep(uNearFadeRange.x, uNearFadeRange.y, vCamDist);
    if (nearFade < 0.003) discard;

    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    float rCent = length(centered * 2.0);

    // Gentle monotonic radial outward expansion as the cloud parts around the cabin (NO time-oscillating wobble!)
    if (vPassProx > 0.01) {
      vec2 radDir = centered / max(length(centered), 0.001);
      uv = clamp(uv - radDir * (vPassProx * 0.09 * (1.0 - rCent * 0.40)), 0.002, 0.998);
    }

    vec4 texMain;

    // Strictly constant flowRate per cloud -> ZERO phase-jump strobing or flickering!
    if (uFlowAmount > 0.01) {
      vec2 flowVec = evalFlowField(uv, uSeed);
      float edgeWeight = mix(0.42, 1.15, smoothstep(0.15, 0.85, rCent));
      float flowScale = 0.092 * uFlowAmount * (0.65 + 0.35 * uWispiness) * edgeWeight;

      float flowRate = 0.088 + 0.028 * fract(uSeed * 0.37);
      float tFlow = uTime * flowRate + fract(uSeed * 0.61);
      float phase0 = fract(tFlow);
      float phase1 = fract(tFlow + 0.5);
      float blend = abs(2.0 * phase0 - 1.0);

      vec2 uv0 = clamp(uv - flowVec * (phase0 - 0.5) * flowScale, 0.002, 0.998);
      vec2 uv1 = clamp(uv - flowVec * (phase1 - 0.5) * flowScale, 0.002, 0.998);

      vec4 s0 = texture2D(uMap, uv0);
      vec4 s1 = texture2D(uMap, uv1);
      texMain = mix(s0, s1, blend);

      float wispMod = vnoise(uv * 4.5 - vec2(uTime * 0.12 * uFlowDir, uTime * 0.045) + uSeed);
      texMain.a *= mix(0.88, 1.12, wispMod);
    } else {
      texMain = texture2D(uMap, uv);
    }

    // === UNIQUE PER-CLOUD ORGANIC SHAPE CARVING ===
    vec2 carveP = uv * 2.7 + vec2(uSeed * 3.11, uSeed * 1.97);
    float carveMacro = vnoise(carveP);
    float carveDetail = vnoise(carveP * 2.4 + vec2(5.1, 2.7));
    float uniqueMask = smoothstep(0.16, 0.80, carveMacro * 0.62 + carveDetail * 0.38 + texMain.a * 0.48);

    float rawDensity = clamp(texMain.a * mix(0.72, 1.18, uniqueMask), 0.0, 1.0);
    if (rawDensity < 0.005) discard;

    // === PHYSICAL BEER-LAMBERT TRANSMITTANCE CURVE ===
    float gamma = mix(1.55, 1.12, uWispiness);
    float tau = pow(rawDensity, gamma) * uOpticalDepth;
    float beerAlpha = 1.0 - exp(-tau);

    // Smooth core softening as the quad hands off to the volumetric thick-smoke immersion shader
    float passHollow = 1.0 - smoothstep(0.25, 0.95, vPassProx) * (1.0 - smoothstep(0.0, 0.68, rCent)) * 0.48;
    float density = beerAlpha * passHollow;

    float organicEdge = 1.0 - smoothstep(0.58, 0.98, rCent + (carveMacro - 0.5) * 0.28);

    // === 3D VOLUMETRIC PUFF LIGHTING ===
    vec3 dir = normalize(vWorldPos - cameraPosition);
    vec3 toCam = -dir;
    vec3 puffN = normalize(
      vAxisX * (centered.x * 1.55) +
      vAxisY * (centered.y * 1.45 + 0.22) +
      toCam * 0.68 +
      vec3(0.0, 0.38, 0.0)
    );
    float sunLit3D = dot(puffN, uSunDir) * 0.5 + 0.5;
    float sunAlign = max(dot(dir, uSunDir), 0.0);
    float silver = pow(sunAlign, 4.2) * 0.22;

    float safeTexLuma = mix(0.78, max(texMain.r, 0.54), smoothstep(0.05, 0.32, texMain.a));
    float microRelief = (carveDetail - 0.5) * 0.14;
    float luma = clamp(safeTexLuma * 0.72 + sunLit3D * 0.28 + microRelief + uShadeBias, 0.14, 0.96);

    // === DAYTIME PHOTO-MIST GRADE ===
    vec3 dayShadow = vec3(0.54, 0.66, 0.82);
    vec3 dayBright = vec3(1.01, 1.005, 0.995) + silver;
    vec3 dayCol = mix(dayShadow, dayBright, smoothstep(0.46, 0.94, luma));

    // === DUSK / NIGHT PHOTO-MIST GRADE ===
    vec3 flatDir = normalize(vec3(dir.x, 0.0, dir.z));
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    float az = pow(max(dot(flatDir, flatSun), 0.0), 2.0);

    vec3 nightShadow = vec3(0.14, 0.22, 0.42);
    vec3 nightLit = vec3(0.48, 0.62, 0.85);
    vec3 nightCol = mix(nightShadow, nightLit, smoothstep(0.46, 0.94, luma));
    nightCol = mix(nightCol, vec3(0.95, 0.55, 0.26), az * 0.45 * smoothstep(0.58, 0.94, luma));
    float underBounce = (1.0 - smoothstep(0.05, 0.62, uv.y)) * (uShadeBias < 0.0 ? 1.25 : 0.78);
    nightCol += vec3(0.92, 0.53, 0.20) * underBounce * 0.20;

    vec3 col = mix(dayCol, nightCol, uNight);

    // === SEAMLESS HORIZON HAZE INTEGRATION ===
    float horizDist = length(vWorldPos.xz);
    float hazeT = smoothstep(105.0, 355.0, horizDist);
    vec3 dayHaze = vec3(0.73, 0.855, 0.948);
    vec3 nightHaze = mix(vec3(0.10, 0.16, 0.31), vec3(0.76, 0.44, 0.21), az * 0.68);
    col = mix(col, mix(dayHaze, nightHaze, uNight), hazeT * 0.80);

    float alpha = density * organicEdge * nearFade * uLifecycleAlpha * uOpacity;
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

// === 3D WORLD-SPACE VOLUMETRIC THICK-SMOKE IMMERSION DOME ===
// Anchored in 3D space around the aircraft (SphereGeometry BackSide, matching atmosphere/cirrus):
// - Looking forward: thick billowing smoke smoothly expands radially outward from the flight vector
// - Looking out side windows: the exact same 3D smoke streams smoothly horizontally past the glass
// - Looking down/back: smoke drifts smoothly backward beneath and behind the tail
// - Strictly monotonic accumulated `uSmokeTravel` -> ZERO flicker, ZERO strobing, ZERO phase jumps!
const SMOKE_IMMERSION_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SMOKE_IMMERSION_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec3 vDir;

  uniform vec3 uFlightDir;
  uniform vec3 uSunDir;
  uniform float uImmersion;     // Smoothly damped 0..1 envelope while gliding inside a thick cloud
  uniform float uSmokeTravel;   // Strictly monotonic accumulated flight travel (zero phase jumps!)
  uniform float uNight;
  uniform float uLateralBias;   // -1..+1 biases thicker smoke slightly toward the cloud core side

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.53);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float smokeFbm(vec2 p) {
    float v = 0.0;
    float a = 0.54;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = rot * p * 2.02 + vec2(1.7, 3.1);
      a *= 0.48;
    }
    return v;
  }

  // Smooth radially expanding smoke layer in 2D flight-cross-section coordinates (zero seam!)
  float evalForwardSmoke(vec2 xy, float travel, float seedOff) {
    float ph0 = fract(travel);
    float ph1 = fract(travel + 0.5);
    float w0 = sin(ph0 * 3.14159265);
    float w1 = sin(ph1 * 3.14159265);
    float wSum = max(w0 + w1, 0.001);

    float scale0 = mix(2.60, 0.58, ph0);
    float scale1 = mix(2.60, 0.58, ph1);

    vec2 p0 = xy * scale0 + vec2(seedOff, seedOff * 1.37 - ph0 * 0.22);
    vec2 p1 = xy * scale1 + vec2(seedOff + 7.3, seedOff * 0.71 - ph1 * 0.22);

    vec2 warp0 = vec2(
      smokeFbm(p0 * 0.75 + vec2(2.1, 1.4)),
      smokeFbm(p0 * 0.75 + vec2(6.4, 3.9))
    ) - vec2(0.5, 0.5);
    vec2 warp1 = vec2(
      smokeFbm(p1 * 0.75 + vec2(2.1, 1.4)),
      smokeFbm(p1 * 0.75 + vec2(6.4, 3.9))
    ) - vec2(0.5, 0.5);

    float d0 = smokeFbm(p0 + warp0 * 0.85);
    float d1 = smokeFbm(p1 + warp1 * 0.85);

    return (d0 * w0 + d1 * w1) / wSum;
  }

  void main() {
    if (uImmersion < 0.002) discard;

    vec3 rayDir = normalize(vDir);

    // Orthonormal 3D aircraft flight frame: F = forward, U = up, R = right wing
    vec3 F = normalize(uFlightDir);
    vec3 U = vec3(0.0, 1.0, 0.0);
    vec3 R = normalize(cross(F, U));

    float zAlong = dot(rayDir, F);
    float xRight = dot(rayDir, R);
    float yUp    = dot(rayDir, U);

    // 1. Forward / rear perspective-projected radial smoke (expands outward from flight nose!)
    float denom = max(abs(zAlong) + 0.35, 0.35);
    vec2 noseProj = vec2(xRight, yUp) / denom;
    float fwdTravel = zAlong >= 0.0 ? uSmokeTravel : -uSmokeTravel;
    float broadFwd = evalForwardSmoke(noseProj * 0.95, fwdTravel * 0.36, 1.4);
    float fineFwd  = evalForwardSmoke(noseProj * 1.48 + vec2(0.18, -0.12), fwdTravel * 0.58, 5.9);
    float radialLayer = clamp(broadFwd * 0.64 + fineFwd * 0.42, 0.0, 1.0);

    // 2. Side / belly / canopy cylindrical streaming smoke (glides smoothly past side windows!)
    float cylPerp = max(length(vec2(xRight, yUp)), 0.15);
    float tunnelZ = (zAlong / cylPerp) * 0.85 + uSmokeTravel * 1.45;
    float ringCoord = atan(yUp, xRight);
    vec2 sideUv = vec2(tunnelZ * 0.72, cos(ringCoord) * 1.25 + sin(ringCoord) * 1.25);
    vec2 sideWarp = vec2(
      smokeFbm(sideUv * 0.65 + vec2(3.2, 1.7)),
      smokeFbm(sideUv * 0.65 + vec2(8.1, 4.3))
    ) - vec2(0.5, 0.5);
    float sideLayer = smokeFbm(sideUv + sideWarp * 0.75);

    // Seamlessly blend forward/rear radial expansion with side-window cylindrical streaming (1.0 weight at zAlong=0 -> zero seam!)
    float sideMix = 1.0 - smoothstep(0.28, 0.76, abs(zAlong));
    float billow = mix(radialLayer, sideLayer, sideMix);

    // High-contrast sculpted smoke plumes (maps tight FBM [0.34..0.68] into rich rolling clouds + wispy gaps!)
    float plume = smoothstep(0.34, 0.68, billow);
    float fineTendril = smoothstep(0.38, 0.72, mix(fineFwd, sideLayer, sideMix));
    float sculptedSmoke = clamp(plume * 0.76 + fineTendril * 0.24, 0.0, 1.0);

    // Thick-smoke immersion profile:
    // - On entry (uImmersion 0.0..0.45): thick rolling smoke wraps inward from outer peripheral angles first
    // - At peak immersion (uImmersion 0.7..1.0): full dense enveloping thick smoke across 360°
    float periphAngle = length(vec2(xRight, yUp));
    float sideDensityBias = clamp(xRight * uLateralBias * 0.28, -0.20, 0.24);
    float edgeEnvelop = mix(
      smoothstep(0.08, 0.82, periphAngle + sideDensityBias),
      1.0,
      smoothstep(0.12, 0.80, uImmersion)
    );

    // Physical Beer-Lambert optical thickness: dense billowing smoke pockets (~0.92 opacity) with soft wispy pockets (~0.28)
    float smokeDensity = mix(0.28, 1.15, sculptedSmoke);
    float tau = uImmersion * edgeEnvelop * smokeDensity * 2.85;
    float alpha = (1.0 - exp(-tau)) * 0.93;
    if (alpha < 0.003) discard;

    // === PHYSICAL IN-CLOUD VOLUMETRIC LIGHTING (DAY + NIGHT) ===
    float sunDot = max(dot(rayDir, uSunDir), 0.0);
    float mieGlow = pow(sunDot, 2.4) * 0.28 + pow(sunDot, 6.5) * 0.20;
    float topGrad = smoothstep(-0.55, 0.55, rayDir.y);

    // Daytime thick cloud interior: sculpted silver-blue shadowed folds + bright warm-white sunlit billows
    vec3 dayDeep = vec3(0.68, 0.79, 0.90);
    vec3 dayLit  = vec3(0.985, 0.992, 1.0) + vec3(0.06, 0.05, 0.025) * mieGlow;
    vec3 daySmoke = mix(dayDeep, dayLit, clamp(sculptedSmoke * 0.68 + topGrad * 0.28 + mieGlow * 0.45, 0.0, 1.0));

    // Nighttime thick cloud interior: deep moody twilight indigo folds + luminous periwinkle ridges + amber/city glow!
    vec3 flatRay = normalize(vec3(rayDir.x, 0.0, rayDir.z) + vec3(0.0001, 0.0, 0.0));
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0001, 0.0, 0.0));
    float azGlow = pow(max(dot(flatRay, flatSun), 0.0), 2.0);

    vec3 nightDeep = vec3(0.07, 0.11, 0.22);
    vec3 nightMid  = vec3(0.25, 0.35, 0.55);
    vec3 nightSmoke = mix(nightDeep, nightMid, clamp(sculptedSmoke * 0.72 + topGrad * 0.22, 0.0, 1.0));
    nightSmoke = mix(nightSmoke, vec3(0.62, 0.38, 0.25), azGlow * (0.34 + sculptedSmoke * 0.24));
    float cityGlowBelow = (1.0 - smoothstep(-0.58, 0.12, rayDir.y)) * (0.45 + sculptedSmoke * 0.55);
    nightSmoke += vec3(0.52, 0.30, 0.12) * cityGlowBelow * 0.38;

    vec3 col = mix(daySmoke, nightSmoke, uNight);
    gl_FragColor = vec4(col, alpha);
  }
`;

const CIRRUS_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CIRRUS_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec3 vDir;
  uniform vec2 uFlightOffset;
  uniform float uNight;
  uniform vec3 uSunDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.5);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.08;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    if (vDir.y <= 0.015) discard;
    float t = 44.0 / vDir.y;
    if (t > 680.0) discard;

    vec2 xz = vDir.xz * t + uFlightOffset * 0.28;
    vec2 p = xz * vec2(0.0034, 0.0082);
    float warp = fbm(p * 1.4);
    float streak = fbm(p + vec2(warp * 1.35, -warp * 0.6));
    float detail = fbm(p * 2.8 + vec2(streak * 0.9, 0.0));

    float wisps = smoothstep(0.46, 0.84, streak * 0.72 + detail * 0.34);
    float elevFade = smoothstep(0.02, 0.14, vDir.y) * (1.0 - smoothstep(0.32, 0.78, vDir.y));
    float distFade = 1.0 - smoothstep(240.0, 650.0, t);
    float alpha = wisps * elevFade * distFade * 0.38;
    if (alpha < 0.005) discard;

    vec3 dayCol = vec3(0.97, 0.985, 1.0);
    float az = pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
    vec3 nightCol = mix(vec3(0.24, 0.34, 0.56), vec3(0.86, 0.50, 0.26), az * 0.72);
    gl_FragColor = vec4(mix(dayCol, nightCol, uNight), alpha);
  }
`;

export const PHOTO_MIST_ASSET_NAMES = [
  'mist-tower-tall',
  'mist-tower-lean',
  'mist-bank-wide',
  'mist-puff-cluster',
  'mist-anvil-spread',
  'mist-wisp-ribbon',
  'mist-twin-peaks',
  'mist-crescent-sweep',
  'mist-ragged-shear',
  'mist-scattered-flock',
  'mist-shelf-stepped',
  'mist-veil-wisps',
] as const;

interface VaporCloudInstance {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  along0: number;
  cross0: number;
  passSide: number; // Sign-locked at spawn (+1 or -1) so clouds NEVER jump across the centerline!
  altitude: number;
  shelf: number;
  subLayer: number;
  opacityMul: number;
  opticalDepth: number;
  groundAlign: number;
  aspectJitter: number;
  baseRoll: number;
  flowAmount: number;
  bobAmp: number;
  bobPhase: number;
  texIdx: number;
  radius: number;
}

interface PassThroughCluster {
  along0: number;
  cross0: number;
  altitude: number;
  halfLength: number;
  halfWidth: number;
}

function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function smoothstepJS(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface VaporCloudField {
  group: THREE.Group;
  cirrusMesh: THREE.Mesh;
  smokeMesh: THREE.Mesh;
  update: (
    camera: THREE.PerspectiveCamera,
    flightTravel: number,
    flightOffset2D: THREE.Vector2,
    sunDir: THREE.Vector3,
    night: number,
    time: number,
    dt: number,
    speedScale: number
  ) => { immersion: number };
  setTextures: (textures: THREE.Texture[]) => void;
  dispose: () => void;
}

export const FLIGHT_DIR_XZ = new THREE.Vector2(0.5547, -0.8321).normalize();
const CROSS_DIR_XZ = new THREE.Vector2(-FLIGHT_DIR_XZ.y, FLIGHT_DIR_XZ.x);
const FLIGHT_DIR_3D = new THREE.Vector3(FLIGHT_DIR_XZ.x, 0, FLIGHT_DIR_XZ.y);

export function createVaporCloudField(sunDir: THREE.Vector3): VaporCloudField {
  const group = new THREE.Group();
  const planeGeo = new THREE.PlaneGeometry(1, 1, 6, 4);

  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
  dummyTex.needsUpdate = true;

  const rand = seededRand(202611259);
  const instances: VaporCloudInstance[] = [];
  const passClusters: PassThroughCluster[] = [];
  const materials: THREE.ShaderMaterial[] = [];

  const WRAP_RADIUS = 395;
  const WRAP_SPAN = WRAP_RADIUS * 2;

  const globalSubtlety = 0.80;
  const globalWispiness = 0.90;

  function makeDeck(pool: number[]) {
    let bag: number[] = [];
    let last = -1;
    return () => {
      if (bag.length === 0) {
        bag = [...pool];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag.length > 1 && bag[bag.length - 1] === last) {
          [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
        }
      }
      last = bag.pop()!;
      return last;
    };
  }

  function addVolume(opts: {
    along: number;
    cross: number;
    altitude: number;
    w: number;
    texIdx: number;
    shelf: number;
    subLayer: number;
    opacityMul: number;
    opticalDepth: number;
    groundAlign: number;
    shadeBias: number;
    flowAmount: number;
    roll?: number;
    passSide?: number;
    nearFadeRange?: [number, number];
  }) {
    const roll = opts.roll ?? (rand() - 0.5) * 0.24;
    const aspectJitter = 0.88 + rand() * 0.26;
    const flowDir = rand() > 0.35 ? 1.0 : -1.0;
    const passSide = opts.passSide ?? (opts.cross >= 0 ? 1 : -1);
    const nearRange = opts.nearFadeRange ?? [7.5, 24.0];

    const uniforms: Record<string, THREE.IUniform> = {
      uMap: { value: dummyTex },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uFlightDir: { value: FLIGHT_DIR_3D.clone() },
      uCenterWorld: { value: new THREE.Vector3(0, opts.altitude, 0) },
      uSize: { value: new THREE.Vector2(opts.w, opts.w * 0.65) },
      uFlipX: { value: rand() > 0.5 ? 1.0 : 0.0 },
      uRoll: { value: roll },
      uGroundAlign: { value: opts.groundAlign },
      uPassProximity: { value: 0.0 },
      uSideSign: { value: passSide },
      uPartDir: { value: new THREE.Vector3(0, 0, 0) },
      uSunDir: { value: sunDir.clone().normalize() },
      uNight: { value: 0.0 },
      uOpacity: { value: globalSubtlety * opts.opacityMul },
      uOpticalDepth: { value: opts.opticalDepth },
      uWispiness: { value: globalWispiness },
      uLifecycleAlpha: { value: 1.0 },
      uFlowAmount: { value: opts.flowAmount },
      uFlowDir: { value: flowDir },
      uShadeBias: { value: opts.shadeBias },
      uNearFadeRange: { value: new THREE.Vector2(nearRange[0], nearRange[1]) },
      uTime: { value: 0.0 },
      uSeed: { value: rand() * 95.0 + 3.0 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: VAPOR_CLOUD_VERTEX,
      fragmentShader: VAPOR_CLOUD_FRAGMENT,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    materials.push(mat);

    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);

    instances.push({
      mesh,
      uniforms,
      along0: opts.along,
      cross0: opts.cross,
      passSide,
      altitude: opts.altitude,
      shelf: opts.shelf,
      subLayer: opts.subLayer,
      opacityMul: opts.opacityMul,
      opticalDepth: opts.opticalDepth,
      groundAlign: opts.groundAlign,
      aspectJitter,
      baseRoll: roll,
      flowAmount: opts.flowAmount,
      bobAmp: opts.flowAmount > 0 ? 0.25 + rand() * 0.30 : 0.0,
      bobPhase: rand() * Math.PI * 2,
      texIdx: opts.texIdx,
      radius: opts.w * 0.85,
    });
  }

  // === SHELF 0: DISTANT HORIZON BANKS & BROAD FORMATIONS (24 clouds) ===
  const horizonDeck = makeDeck([2, 4, 6, 7, 8, 10]);
  for (let i = 0; i < 24; i++) {
    const along = (i / 24) * WRAP_SPAN - WRAP_RADIUS + (rand() - 0.5) * 28;
    const side = i % 2 === 0 ? 1 : -1;
    const cross = side * (165 + rand() * 185);
    const w = 132 + rand() * 82;
    const isFlowing = rand() < 0.22;
    addVolume({
      along,
      cross,
      altitude: -34 + (rand() - 0.5) * 4.0,
      w,
      texIdx: horizonDeck(),
      shelf: 0,
      subLayer: 1,
      opacityMul: 0.90,
      opticalDepth: 2.05,
      groundAlign: 0.10,
      shadeBias: -0.02,
      flowAmount: isFlowing ? 0.45 + rand() * 0.30 : 0.0,
    });
  }

  // === SHELF 1: SCULPTED 3D LOWER CLOUD CLUSTERS OVER FARMLAND & CITIES (18 × 2 = 36 clouds) ===
  const lowBaseDeck = makeDeck([2, 4, 6, 7, 8, 10]);
  const lowCrownDeck = makeDeck([0, 1, 3, 6, 8, 9]);
  for (let i = 0; i < 18; i++) {
    const along = (i / 18) * WRAP_SPAN - WRAP_RADIUS + (rand() - 0.5) * 30;
    const cross = (rand() - 0.5) * WRAP_SPAN * 0.78;
    const baseTex = lowBaseDeck();
    const crownTex = lowCrownDeck();
    const wBase = 62 + rand() * 34;
    const baseAlt = -46 + (rand() - 0.5) * 3.0;
    const isFlowing = rand() < 0.34;
    const flowAmt = isFlowing ? 0.45 + rand() * 0.30 : 0.0;

    addVolume({
      along,
      cross,
      altitude: baseAlt,
      w: wBase * 1.10,
      texIdx: baseTex,
      shelf: 1,
      subLayer: 0,
      opacityMul: 0.80,
      opticalDepth: 1.95,
      groundAlign: 0.48,
      shadeBias: -0.16,
      flowAmount: flowAmt * 0.6,
      roll: (rand() - 0.5) * 0.35,
    });

    addVolume({
      along: along + 4.2,
      cross: cross + 3.2,
      altitude: baseAlt + 4.6,
      w: wBase * 0.86,
      texIdx: crownTex,
      shelf: 1,
      subLayer: 2,
      opacityMul: 0.90,
      opticalDepth: 2.25,
      groundAlign: 0.22,
      shadeBias: 0.05,
      flowAmount: flowAmt,
      roll: (rand() - 0.5) * 0.22,
    });
  }

  // === SHELF 2: MID-ALTITUDE 3D MULTI-SLICE CLOUDS (16 × 2 + wisps = 40 clouds) ===
  const midDeck = makeDeck([0, 1, 2, 3, 4, 6, 7, 8, 9, 10]);
  const wispDeck = makeDeck([5, 11, 8, 9]);
  for (let i = 0; i < 16; i++) {
    const along = (i / 16) * WRAP_SPAN - WRAP_RADIUS + (rand() - 0.5) * 30;
    const cross = (rand() - 0.5) * WRAP_SPAN * 0.76;
    const texIdx = midDeck();
    const isBroad = texIdx === 2 || texIdx === 4 || texIdx === 6 || texIdx === 7 || texIdx === 10;
    const w = isBroad ? 92 + rand() * 42 : 66 + rand() * 30;
    const alt = -25 + (rand() - 0.5) * 4.0;
    const isFlowing = rand() < 0.40;
    const flowAmt = isFlowing ? 0.52 + rand() * 0.38 : 0.0;

    addVolume({
      along: along + 8.5,
      cross: cross + (rand() - 0.5) * 8,
      altitude: alt - 2.0,
      w: w * 0.94,
      texIdx,
      shelf: 2,
      subLayer: 0,
      opacityMul: 0.80,
      opticalDepth: 2.0,
      groundAlign: 0.22,
      shadeBias: -0.12,
      flowAmount: flowAmt * 0.7,
    });

    addVolume({
      along: along - 5.5,
      cross,
      altitude: alt + 1.4,
      w,
      texIdx,
      shelf: 2,
      subLayer: 1,
      opacityMul: 0.92,
      opticalDepth: 2.15,
      groundAlign: 0.12,
      shadeBias: 0.05,
      flowAmount: flowAmt,
    });

    if (i % 2 === 0) {
      const sideOff = (rand() > 0.5 ? 1 : -1) * (w * 0.34);
      addVolume({
        along: along - 12.0,
        cross: cross + sideOff,
        altitude: alt - 1.2,
        w: w * 0.72,
        texIdx: wispDeck(),
        shelf: 2,
        subLayer: 2,
        opacityMul: 0.56,
        opticalDepth: 1.25,
        groundAlign: 0.16,
        shadeBias: 0.02,
        flowAmount: 0.78 + rand() * 0.22,
      });
    }
  }

  // === SHELF 3: SEAMLESS THICK-SMOKE PASS-THROUGH CLUSTERS (6 clusters × 3 broad soft volumes) ===
  // Wide nearFadeRange [18, 56] dissolves individual quads smoothly BEFORE they touch the lens,
  // handing off continuously to the fullscreen volumetric thick-smoke immersion shader!
  const skimCoreDeck = makeDeck([8, 9, 3, 1, 6, 7]);
  const skimWispDeck = makeDeck([5, 11, 8, 9]);
  for (let i = 0; i < 6; i++) {
    const along = (i / 6) * WRAP_SPAN - WRAP_RADIUS + (rand() - 0.5) * 22;
    // 4 directly along the flight path for immersive thick-smoke pass-throughs, 2 grazing flanks
    const isDirectPass = i % 3 !== 2;
    const cross = isDirectPass
      ? (rand() - 0.5) * 32
      : (rand() > 0.5 ? 1 : -1) * (46 + rand() * 44);
    const clusterSide = cross >= 0 ? 1 : -1;
    const alt = isDirectPass ? -5.0 + (rand() - 0.5) * 3.5 : -9.0 + (rand() - 0.5) * 4.0;
    const baseW = 62 + rand() * 20;
    const coreTex = skimCoreDeck();
    const wispTexA = skimWispDeck();
    const wispTexB = skimWispDeck();

    // Register ONE continuous volumetric ellipsoid envelope per cluster (zero multi-slice pulsing!)
    passClusters.push({
      along0: along,
      cross0: cross,
      altitude: alt,
      halfLength: 38,
      halfWidth: 36,
    });

    // Trailing outer cloud body (farthest -> drawn first)
    addVolume({
      along: along + 18.0,
      cross: cross + clusterSide * 4.0,
      altitude: alt - 1.2,
      w: baseW * 1.12,
      texIdx: wispTexA,
      shelf: 3,
      subLayer: 0,
      opacityMul: 0.52,
      opticalDepth: 1.25,
      groundAlign: 0.14,
      shadeBias: -0.05,
      flowAmount: 0.72,
      passSide: clusterSide,
      nearFadeRange: [18.0, 56.0],
    });

    // Main central cloud volume
    addVolume({
      along,
      cross,
      altitude: alt,
      w: baseW,
      texIdx: coreTex,
      shelf: 3,
      subLayer: 1,
      opacityMul: 0.68,
      opticalDepth: 1.55,
      groundAlign: 0.10,
      shadeBias: 0.02,
      flowAmount: 0.62,
      passSide: clusterSide,
      nearFadeRange: [18.0, 56.0],
    });

    // Leading wispy vapor approach
    addVolume({
      along: along - 18.0,
      cross: cross - clusterSide * 3.0,
      altitude: alt + 1.0,
      w: baseW * 1.08,
      texIdx: wispTexB,
      shelf: 3,
      subLayer: 2,
      opacityMul: 0.46,
      opticalDepth: 1.10,
      groundAlign: 0.12,
      shadeBias: 0.06,
      flowAmount: 0.76,
      passSide: clusterSide,
      nearFadeRange: [18.0, 56.0],
    });
  }

  // Deterministic constant draw order: (shelf ASC, subLayer ASC, abs(cross0) DESC)
  instances.sort((a, b) => {
    if (a.shelf !== b.shelf) return a.shelf - b.shelf;
    if (a.subLayer !== b.subLayer) return a.subLayer - b.subLayer;
    return Math.abs(b.cross0) - Math.abs(a.cross0);
  });
  for (let i = 0; i < instances.length; i++) {
    instances[i].mesh.renderOrder = 10 + i;
  }

  // High wispy cirrus dome above cruise altitude
  const cirrusUniforms: Record<string, THREE.IUniform> = {
    uFlightOffset: { value: new THREE.Vector2(0, 0) },
    uNight: { value: 0.0 },
    uSunDir: { value: sunDir.clone().normalize() },
  };
  const cirrusGeo = new THREE.SphereGeometry(760, 40, 24);
  const cirrusMat = new THREE.ShaderMaterial({
    vertexShader: CIRRUS_VERTEX,
    fragmentShader: CIRRUS_FRAGMENT,
    uniforms: cirrusUniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const cirrusMesh = new THREE.Mesh(cirrusGeo, cirrusMat);
  cirrusMesh.renderOrder = 2;
  cirrusMesh.frustumCulled = false;

  // 3D World-Space Volumetric Thick-Smoke Immersion Dome (zero GPU cost when clear air!)
  const smokeUniforms: Record<string, THREE.IUniform> = {
    uFlightDir: { value: FLIGHT_DIR_3D.clone() },
    uSunDir: { value: sunDir.clone().normalize() },
    uImmersion: { value: 0.0 },
    uSmokeTravel: { value: 0.0 },
    uNight: { value: 0.0 },
    uLateralBias: { value: 0.0 },
  };
  const smokeGeo = new THREE.SphereGeometry(20, 36, 20);
  const smokeMat = new THREE.ShaderMaterial({
    vertexShader: SMOKE_IMMERSION_VERTEX,
    fragmentShader: SMOKE_IMMERSION_FRAGMENT,
    uniforms: smokeUniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const smokeMesh = new THREE.Mesh(smokeGeo, smokeMat);
  smokeMesh.renderOrder = 250;
  smokeMesh.frustumCulled = false;
  smokeMesh.visible = false;

  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const partTmp = new THREE.Vector3();

  let smoothedImmersion = 0;
  let smoothedLateralBias = 0;
  let smokeTravel = 0;

  function wrapAlong(v: number): number {
    return ((((v + WRAP_RADIUS) % WRAP_SPAN) + WRAP_SPAN) % WRAP_SPAN) - WRAP_RADIUS;
  }

  return {
    group,
    cirrusMesh,
    smokeMesh,
    setTextures(textures: THREE.Texture[]) {
      if (textures.length === 0) return;
      for (const inst of instances) {
        const tex = textures[inst.texIdx % textures.length];
        inst.uniforms.uMap.value = tex;
        const img = tex.image as { width?: number; height?: number } | undefined;
        if (img?.width && img?.height) {
          const size = inst.uniforms.uSize.value as THREE.Vector2;
          size.y = size.x * (img.height / img.width) * inst.aspectJitter;
          inst.radius = Math.max(size.x, size.y) * 0.95;
        }
      }
    },
    update(camera, flightTravel, flightOffset2D, nextSunDir, night, time, dt, speedScale) {
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

      cirrusUniforms.uFlightOffset.value.copy(flightOffset2D);
      cirrusUniforms.uNight.value = night;
      cirrusUniforms.uSunDir.value.copy(nextSunDir);

      // 1. Compute ONE smooth, continuous thick-smoke immersion envelope across all Shelf 3 clusters
      let targetImmersion = 0;
      let targetLateral = 0;
      for (let i = 0; i < passClusters.length; i++) {
        const cl = passClusters[i];
        const along = wrapAlong(cl.along0 - flightTravel);
        // Normalized 3D ellipsoidal distance inside the thick cloud cluster
        const normAlong = along / cl.halfLength;
        const normCross = cl.cross0 / cl.halfWidth;
        const normAlt = cl.altitude / 18.0;
        const ellipDist = Math.hypot(normAlong, normCross, normAlt);
        if (ellipDist < 1.35) {
          const env = 1.0 - smoothstepJS(0.18, 1.32, ellipDist);
          if (env > targetImmersion) {
            targetImmersion = env;
            targetLateral = THREE.MathUtils.clamp(cl.cross0 / 28.0, -1, 1);
          }
        }
      }

      // Asymmetric silky damping: slow organic build-in (~0.55s) and calm breathable clear-out (~0.85s)
      const rate = targetImmersion > smoothedImmersion ? 2.4 : 1.7;
      smoothedImmersion = THREE.MathUtils.lerp(
        smoothedImmersion,
        targetImmersion,
        1.0 - Math.exp(-dt * rate)
      );
      if (smoothedImmersion < 0.001 && targetImmersion === 0) smoothedImmersion = 0;

      smoothedLateralBias = THREE.MathUtils.lerp(
        smoothedLateralBias,
        targetLateral,
        1.0 - Math.exp(-dt * 2.0)
      );

      // Strictly monotonic accumulated optical-flow travel (calm, weighty thick-smoke glide — zero flicker!)
      smokeTravel += dt * 0.50 * speedScale;

      if (smoothedImmersion > 0.002) {
        smokeMesh.visible = true;
        smokeMesh.position.copy(camera.position);
        smokeUniforms.uSunDir.value.copy(nextSunDir);
        smokeUniforms.uImmersion.value = smoothedImmersion * THREE.MathUtils.clamp(globalSubtlety * 1.15, 0.4, 1.0);
        smokeUniforms.uSmokeTravel.value = smokeTravel;
        smokeUniforms.uNight.value = night;
        smokeUniforms.uLateralBias.value = smoothedLateralBias;
      } else {
        smokeMesh.visible = false;
      }

      // 2. Update all 3D cloud volumes with sign-locked smooth bow-wave parting
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const along = wrapAlong(inst.along0 - flightTravel);
        const crossDrift =
          inst.flowAmount > 0
            ? Math.sin(time * 0.22 + inst.bobPhase) * 1.8 * inst.flowAmount
            : 0;
        let cross = inst.cross0 + crossDrift;
        let wy =
          inst.altitude +
          (inst.bobAmp > 0 ? Math.sin(time * 0.32 + inst.bobPhase) * inst.bobAmp : 0);

        const radialNorm = Math.hypot(along, cross) / WRAP_RADIUS;
        const lifecycleAlpha = 1.0 - smoothstepJS(0.56, 0.97, radialNorm);

        if (lifecycleAlpha < 0.004) {
          inst.mesh.visible = false;
          continue;
        }

        const rawDist = Math.hypot(along, cross, wy);
        let passProx = 0;

        if (rawDist < 88 && lifecycleAlpha > 0.1) {
          passProx = 1.0 - smoothstepJS(10.0, 88.0, rawDist);
          const proxEase = passProx * passProx * (3.0 - 2.0 * passProx);
          // Smooth sign-locked lateral bow-wave parting (ZERO centerline flip!)
          const bowDeflect = proxEase * 10.5;
          cross += inst.passSide * bowDeflect;
          wy += (inst.altitude < -2.5 ? -1 : 1) * bowDeflect * 0.22;

          partTmp.set(
            CROSS_DIR_XZ.x * inst.passSide * 0.94,
            inst.altitude < -2.5 ? -0.32 : 0.32,
            CROSS_DIR_XZ.y * inst.passSide * 0.94
          ).normalize();
          (inst.uniforms.uPartDir.value as THREE.Vector3).copy(partTmp);
        } else {
          (inst.uniforms.uPartDir.value as THREE.Vector3).set(0, 0, 0);
        }

        const wx = FLIGHT_DIR_XZ.x * along + CROSS_DIR_XZ.x * cross;
        const wz = FLIGHT_DIR_XZ.y * along + CROSS_DIR_XZ.y * cross;

        // Half-space behind-camera cull
        const fwdDot = wx * camFwd.x + wy * camFwd.y + wz * camFwd.z;
        if (fwdDot < -inst.radius * 1.45) {
          inst.mesh.visible = false;
          continue;
        }
        inst.mesh.visible = true;

        const center = inst.uniforms.uCenterWorld.value as THREE.Vector3;
        center.set(wx, wy, wz);

        inst.uniforms.uCamRight.value.copy(camRight);
        inst.uniforms.uCamUp.value.copy(camUp);
        inst.uniforms.uPassProximity.value = passProx;
        inst.uniforms.uRoll.value =
          inst.baseRoll +
          (inst.flowAmount > 0 ? Math.sin(time * 0.24 + inst.bobPhase) * 0.038 * inst.flowAmount : 0) +
          passProx * 0.10 * inst.passSide;
        inst.uniforms.uSunDir.value.copy(nextSunDir);
        inst.uniforms.uNight.value = night;
        inst.uniforms.uOpacity.value = globalSubtlety * inst.opacityMul;
        inst.uniforms.uWispiness.value = globalWispiness;
        inst.uniforms.uLifecycleAlpha.value = lifecycleAlpha;
        inst.uniforms.uTime.value = time;
      }

      return { immersion: smoothedImmersion };
    },
    dispose() {
      planeGeo.dispose();
      cirrusGeo.dispose();
      cirrusMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
      dummyTex.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
