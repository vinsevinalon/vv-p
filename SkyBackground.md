# SkyBackground — Architecture Diagram

## Component Overview

`SkyBackground` renders a full-screen interactive 360° panorama as a fixed canvas behind all page content, using Three.js. It adapts its input method based on the device:

- **Desktop** → mouse drag to look around
- **Android** → gyroscope (no permission needed)
- **iOS** → gyroscope behind a permission prompt

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         SkyBackground                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    React State                          │   │
│  │   showButton: boolean  ──► renders iOS prompt button   │   │
│  │   gyroActive: boolean  ──► (informational)             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               gyroRef (mutable, not reactive)           │   │
│  │   enabled: boolean                                      │   │
│  │   initialized: boolean                                  │   │
│  │   current: Quaternion  ──► smoothed camera rotation    │   │
│  │   target:  Quaternion  ──► latest gyro reading         │   │
│  │   screenOrientation: number                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Initialization Flow (useEffect)

```
useEffect (runs once on mount)
│
├── Create THREE.WebGLRenderer  ──► <canvas> ref
├── Create THREE.Scene
├── Create THREE.PerspectiveCamera (FOV 75°)
│
├── Build 360° sphere
│   ├── SphereGeometry(r=500, 60 segments, 40 rings)
│   ├── Scale X by -1  (invert normals — view from inside)
│   ├── TextureLoader.load('/360.jpg')
│   └── MeshBasicMaterial → add Mesh to scene
│
├── Branch: Desktop vs Mobile
│   ├── Desktop ──► register mouse events (mousedown/move/up)
│   └── Mobile (Android) ──► register deviceorientation + orientationchange
│                             immediately, setGyroActive(true)
│
├── Register window resize handler
│
├── Start animation loop (requestAnimationFrame)
│   └── Each frame:
│       ├── if gyro enabled & initialized:
│       │       current.slerp(target, 0.1)   ← smooth lerp 10%
│       │       camera.quaternion = current
│       └── renderer.render(scene, camera)
│
├── Expose window.__startGyro()  ← for iOS permission button
│
└── Return cleanup fn
    ├── cancelAnimationFrame
    ├── dispose renderer / geometry / material / texture
    └── removeEventListeners
```

---

## Input Paths

### Desktop — Mouse Drag

```
mousedown ──► isDragging = true, record (lastX, lastY)
mousemove ──► Δx → theta -= Δx * 0.003
              Δy → phi   += Δy * 0.003  (clamped 0.05…π-0.05)
              camera.lookAt( spherical → Cartesian )
mouseup   ──► isDragging = false
```

```
theta (horizontal yaw)    phi (vertical pitch)
    ──────────────────────────────────────────
    Unclamped, wraps around    Clamped [0.05, π-0.05]
                               (prevents gimbal flip)
```

### Mobile — Gyroscope

```
DeviceOrientationEvent
 { alpha (yaw), beta (pitch), gamma (roll) }
          │
          ▼
 deviceOrientationToQuaternion(α, β, γ, screenOrientation)
          │
          │   Uses W3C spec rotation matrix:
          │   1. Euler YXZ  ( β, α, -γ )
          │   2. multiply q1 = Quaternion(-√0.5, 0, 0, √0.5)
          │      (converts device frame → camera frame)
          │   3. multiply screenOrientation rotation around Z
          │
          ▼
       target Quaternion
          │
          ▼ (per-frame, in animate loop)
       current.slerp(target, 0.1)   ← smoothing
          │
          ▼
       camera.quaternion = current
```

---

## iOS Permission Flow

```
Initial render (iOS):
  showButton = true  ──► "Enable Gyroscope" button visible

User taps button:
  requestPermission()
    │
    ├── DeviceOrientationEvent.requestPermission()   (must be user gesture)
    │
    ├── 'granted' ──► window.__startGyro()
    │                   registers deviceorientation + orientationchange
    │                 setGyroActive(true)
    │                 setShowButton(false)  ──► button hidden
    │
    └── denied / error ──► setShowButton(false)  ──► button hidden silently
```

---

## Three.js Scene Structure

```
Scene
└── Mesh
    ├── SphereGeometry  (radius 500, inside-out via scale -1,1,1)
    └── MeshBasicMaterial
        └── Texture  ← /360.jpg  (equirectangular panorama, sRGB)

Camera (PerspectiveCamera, FOV 75°)
└── Positioned at origin (0,0,0) — center of sphere
    Rotation controlled by:
      Desktop  → lookAt() from spherical coords (theta, phi)
      Mobile   → quaternion from gyro slerp
```

---

## Component Render Output

```
<>
  <canvas>   fixed, inset 0, z-index -1, 100vw × 100vh
             (Three.js renders into this)

  <button>   fixed, bottom 24px, centered   (iOS only, until tapped)
             "⟳ Enable Gyroscope"
</>
```
