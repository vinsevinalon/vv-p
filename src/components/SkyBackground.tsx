import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
    registerGyroRequester,
    registerSkySwitcher,
    readStoredTheme,
    setSkyProgress,
    SKY_SOURCES,
    type SkyTheme,
} from '../lib/skyBridge';

/**
 * Converts DeviceOrientationEvent angles to a Three.js Quaternion
 * using the W3C spec rotation matrix, accounting for screen orientation.
 * Reference: https://www.w3.org/TR/orientation-event/
 */
function deviceOrientationToQuaternion(
    alpha: number,
    beta: number,
    gamma: number,
    screenAngle: number,
): THREE.Quaternion {
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

    euler.set(
        THREE.MathUtils.degToRad(beta),
        THREE.MathUtils.degToRad(alpha),
        THREE.MathUtils.degToRad(-gamma),
        'YXZ',
    );

    const q = new THREE.Quaternion();
    q.setFromEuler(euler);
    q.multiply(q1);
    q.multiply(q0.setFromAxisAngle(zee, -THREE.MathUtils.degToRad(screenAngle)));
    return q;
}

const getViewportSize = () => ({
    width: Math.round(window.visualViewport?.width ?? window.innerWidth),
    height: Math.round(window.visualViewport?.height ?? window.innerHeight),
});

// Keep the apparent scale of the sky stable across landscape and portrait screens. A fixed
// vertical FOV becomes a tight crop on phones, which makes the clouds feel unnaturally close.
const getSkyFov = (width: number, height: number) => {
    const aspect = width / height;
    const diagonalFov = THREE.MathUtils.degToRad(130);
    const verticalFov = 2 * Math.atan(Math.tan(diagonalFov / 2) / Math.sqrt(1 + aspect ** 2));
    return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(verticalFov), 90, 110);
};

// SphereGeometry places the texture seam at yaw 0. Both panoramas keep their open, distant
// sky in the middle of the image, so face that direction instead of the close clouds at the seam.
const SKY_CENTER_YAW = Math.PI;

// window.orientation is deprecated and absent on current iOS; screen.orientation is the
// supported source, so fall back only for older engines.
const getScreenAngle = () =>
    window.screen?.orientation?.angle ?? (window.orientation as number | undefined) ?? 0;

// Remembering a prior grant lets repeat visits enable with no interaction, without
// making the poisoned unactivated call on a first visit.
const GRANTED_KEY = 'skyGyroGranted';
const wasGranted = () => {
    try {
        return window.localStorage.getItem(GRANTED_KEY) === '1';
    } catch {
        return false;
    }
};
const rememberGranted = () => {
    try {
        window.localStorage.setItem(GRANTED_KEY, '1');
    } catch {
        // Private mode; the next visit simply asks again on first touch.
    }
};
const forgetGranted = () => {
    try {
        window.localStorage.removeItem(GRANTED_KEY);
    } catch {
        // Nothing cached to clear.
    }
};

const panoramaImages = new Map<SkyTheme, Promise<HTMLImageElement | null>>();

const fetchPanoramaImage = (theme: SkyTheme, onProgress?: (value: number) => void) => {
    const existing = panoramaImages.get(theme);
    if (existing) {
        // Already downloading or downloaded; this caller only needs the completion signal.
        void existing.then(() => onProgress?.(1));
        return existing;
    }
    const pending = (async (): Promise<HTMLImageElement | null> => {
        try {
            const response = await fetch(SKY_SOURCES[theme]);
            if (!response.ok) throw new Error(String(response.status));
            const total = Number(response.headers.get('content-length')) || 0;
            let blob: Blob;
            if (!response.body || !total) {
                blob = await response.blob();
            } else {
                const reader = response.body.getReader();
                const chunks: ArrayBuffer[] = [];
                let received = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    // Copy out so the Blob owns plain ArrayBuffers.
                    chunks.push(value.slice().buffer as ArrayBuffer);
                    received += value.length;
                    // Hold back the last percent until the image has actually decoded.
                    onProgress?.(Math.min(0.99, received / total));
                }
                blob = new Blob(chunks, { type: 'image/jpeg' });
            }
            const url = URL.createObjectURL(blob);
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('decode failed'));
                el.src = url;
            });
            // The decoded image is retained for the page's lifetime, so the blob URL is too.
            onProgress?.(1);
            return image;
        } catch {
            // Never trap the visitor behind the loading screen because of a failed image.
            panoramaImages.delete(theme);
            onProgress?.(1);
            return null;
        }
    })();
    panoramaImages.set(theme, pending);
    return pending;
};

type DeviceOrientationConstructorWithPermission = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
};

export default function SkyBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const viewport = getViewportSize();
        const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarsePointer ? 1.5 : 2));
        renderer.setSize(viewport.width, viewport.height, false);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            getSkyFov(viewport.width, viewport.height),
            viewport.width / viewport.height,
            0.1,
            1000,
        );

        // Equirectangular sphere
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        // Two skies stacked so a theme change can cross-fade instead of cutting. depthTest is
        // off and draw order is explicit, which avoids z-fighting between identical spheres.
        const settled = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, depthTest: false, depthWrite: false });
        const incoming = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false });
        const settledMesh = new THREE.Mesh(geometry, settled);
        const incomingMesh = new THREE.Mesh(geometry, incoming);
        settledMesh.renderOrder = 0;
        incomingMesh.renderOrder = 1;
        incomingMesh.visible = false;
        scene.add(settledMesh);
        scene.add(incomingMesh);

        const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
        const textureCache = new Map<SkyTheme, THREE.Texture>();
        let cancelled = false;

        const loadPanorama = async (
            theme: SkyTheme,
            onProgress?: (value: number) => void,
        ): Promise<THREE.Texture | null> => {
            const cached = textureCache.get(theme);
            if (cached) {
                onProgress?.(1);
                return cached;
            }
            const image = await fetchPanoramaImage(theme, onProgress);
            if (cancelled || !image) return null;

            const texture = new THREE.Texture(image);
            texture.colorSpace = THREE.SRGBColorSpace;
            // A non-power-of-two texture with a mipmap minFilter renders black under WebGL1
            // and on stricter mobile drivers, so only mipmap when it is safe.
            const potSafe = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
            texture.generateMipmaps = potSafe;
            texture.minFilter = potSafe ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
            texture.anisotropy = potSafe ? renderer.capabilities.getMaxAnisotropy() : 1;
            texture.needsUpdate = true;

            textureCache.set(theme, texture);
            return texture;
        };

        let activeTheme = readStoredTheme();
        const fade = { active: false, elapsed: 0, duration: 650 };

        void loadPanorama(activeTheme, setSkyProgress).then((texture) => {
            if (cancelled || !texture) return;
            settled.map = texture;
            settled.needsUpdate = true;
        });

        const switchSky = async (theme: SkyTheme) => {
            if (cancelled || theme === activeTheme || fade.active) return;
            const texture = await loadPanorama(theme);
            if (cancelled || !texture) return;
            activeTheme = theme;
            incoming.map = texture;
            incoming.opacity = 0;
            incoming.needsUpdate = true;
            incomingMesh.visible = true;
            fade.elapsed = 0;
            fade.active = true;
        };
        const unregisterSwitcher = registerSkySwitcher(switchSky);

        // Gyro state is scoped to this effect so a StrictMode remount cannot let a stale
        // handler calibrate against a disposed camera.
        const gyro = {
            active: false,
            calibrated: false,
            current: new THREE.Quaternion(),
            target: new THREE.Quaternion(),
            origin: new THREE.Quaternion(),
            relative: new THREE.Quaternion(),
            base: new THREE.Quaternion(),
            screenAngle: getScreenAngle(),
            events: 0,
        };

        // Desktop only: the view follows the cursor. Touch devices are gyroscope-only and
        // register no look-around gestures at all.
        let theta = SKY_CENTER_YAW, phi = Math.PI / 2;
        let targetTheta = theta;
        let targetPhi = phi;
        const clampPhi = (p: number) => Math.max(0.05, Math.min(Math.PI - 0.05, p));

        const applyPointerLook = () => {
            camera.lookAt(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta),
            );
        };
        applyPointerLook();

        const onPointerMove = (e: PointerEvent) => {
            const pointerViewport = getViewportSize();
            const normalizedX = e.clientX / pointerViewport.width - 0.5;
            const normalizedY = e.clientY / pointerViewport.height - 0.5;
            targetTheta = SKY_CENTER_YAW - normalizedX * 0.9;
            targetPhi = clampPhi(Math.PI / 2 + normalizedY * 0.55);
        };
        if (!isCoarsePointer) {
            window.addEventListener('pointermove', onPointerMove);
        }

        const handleOrientation = (e: DeviceOrientationEvent) => {
            if (e.beta === null || e.gamma === null) return;
            const alpha = e.alpha ?? 0;
            if (gyro.events === 0) clearTimeout(probeTimer);
            gyro.events += 1;
            gyro.active = true;

            const q = deviceOrientationToQuaternion(alpha, e.beta, e.gamma, gyro.screenAngle);
            if (!gyro.calibrated) {
                // Anchor to wherever the ambient pan currently sits so the takeover is seamless.
                gyro.origin.copy(q).invert();
                gyro.base.copy(camera.quaternion);
                gyro.current.copy(camera.quaternion);
                gyro.calibrated = true;
            }
            gyro.relative.copy(gyro.origin).multiply(q);
            gyro.target.copy(gyro.base).multiply(gyro.relative);
        };

        const handleScreenOrientation = () => {
            gyro.screenAngle = getScreenAngle();
            // Recalibrate so the neutral view survives the rotation.
            gyro.calibrated = false;
        };

        let orientationListening = false;
        let permissionPending = false;
        let probeTimer = 0;
        const orientationEvent = 'DeviceOrientationEvent' in window
            ? window.DeviceOrientationEvent as DeviceOrientationConstructorWithPermission
            : null;

        const startOrientation = () => {
            if (orientationListening) return;
            orientationListening = true;
            gyro.screenAngle = getScreenAngle();
            window.addEventListener('deviceorientation', handleOrientation, true);
            window.addEventListener('orientationchange', handleScreenOrientation);
            window.screen?.orientation?.addEventListener('change', handleScreenOrientation);
        };

        const requestOrientationPermission = () => {
            if (
                gyro.events > 0
                || permissionPending
                || typeof orientationEvent?.requestPermission !== 'function'
            ) return;

            permissionPending = true;
            // Invoked synchronously so Safari still sees the transient user activation.
            orientationEvent.requestPermission()
                .then((permission) => {
                    if (permission === 'granted') {
                        rememberGranted();
                        startOrientation();
                    } else {
                        forgetGranted();
                    }
                })
                .catch(() => {
                    // Safari rejects until the call originates from a real gesture; the
                    // activation listeners below will try again on the next one.
                })
                .finally(() => {
                    permissionPending = false;
                });
        };

        // Every event WebKit credits with transient activation, so the sensor unlocks on
        // whatever the visitor happens to do first. These listeners never move the view;
        // they exist only to unlock the sensor if the Enter button did not manage it.
        const ACTIVATION_EVENTS = [
            'touchstart', 'touchend', 'pointerdown', 'pointerup',
            'mousedown', 'mouseup', 'click', 'keydown',
        ] as const;
        const onActivation = () => {
            // Listen-first means a listener is always attached, so "already listening" is no
            // longer proof of anything. Only real sensor data means we are done here.
            if (gyro.events > 0) {
                removeActivationListeners();
                return;
            }
            requestOrientationPermission();
        };
        const addActivationListeners = () => {
            for (const type of ACTIVATION_EVENTS) {
                window.addEventListener(type, onActivation, true);
            }
        };
        const removeActivationListeners = () => {
            for (const type of ACTIVATION_EVENTS) {
                window.removeEventListener(type, onActivation, true);
            }
        };

        // Listen first, ask later. The permission gate is not the only path to sensor data:
        // with Settings > Safari > Motion & Orientation Access enabled, and in Home Screen
        // web apps, WebKit delivers deviceorientation without any requestPermission call.
        // Asking first suppresses that path, so attach the listener unconditionally and only
        // fall back to the permission flow if nothing actually arrives.
        if (orientationEvent) {
            startOrientation();
            if (typeof orientationEvent.requestPermission === 'function') {
                addActivationListeners();
                probeTimer = window.setTimeout(() => {
                    // Silent so far. A remembered grant resolves without activation; a first
                    // visit is refused here and waits for the Enter button's click.
                    if (gyro.events === 0 && wasGranted()) requestOrientationPermission();
                }, 700);
            }
        }

        // The loading screen's Enter button calls this from inside its own click handler,
        // which is the one moment iOS will accept a permission request on a first visit.
        const unregisterGyro = registerGyroRequester(requestOrientationPermission);

        const onResize = () => {
            const nextViewport = getViewportSize();
            camera.aspect = nextViewport.width / nextViewport.height;
            camera.fov = getSkyFov(nextViewport.width, nextViewport.height);
            camera.updateProjectionMatrix();
            renderer.setSize(nextViewport.width, nextViewport.height, false);
        };
        window.addEventListener('resize', onResize);
        window.visualViewport?.addEventListener('resize', onResize);

        let animId = 0;
        let previousFrame = performance.now();
        const animate = (now: number) => {
            const elapsed = Math.min(now - previousFrame, 50);
            previousFrame = now;
            if (gyro.active && gyro.calibrated) {
                gyro.current.slerp(gyro.target, 0.12);
                camera.quaternion.copy(gyro.current);
            } else if (!isCoarsePointer) {
                theta += (targetTheta - theta) * 0.06;
                phi += (targetPhi - phi) * 0.06;
                applyPointerLook();
            } else {
                // Runs from load on touch devices, and yields as soon as the sensor engages.
                // Reduced-motion gets a slower, flatter pan rather than a frozen image.
                const rate = reduceMotion ? 0.000015 : 0.00006;
                const sway = reduceMotion ? 0.02 : 0.06;
                theta -= elapsed * rate;
                phi += (clampPhi(Math.PI / 2 + Math.sin(now * 0.00007) * sway) - phi) * 0.02;
                applyPointerLook();
            }
            if (fade.active) {
                fade.elapsed += elapsed;
                const k = Math.min(1, fade.elapsed / fade.duration);
                incoming.opacity = k;
                if (k >= 1) {
                    // Hand the finished sky to the settled layer and park the overlay.
                    settled.map = incoming.map;
                    settled.needsUpdate = true;
                    incoming.opacity = 0;
                    incoming.map = null;
                    incomingMesh.visible = false;
                    fade.active = false;
                }
            }
            renderer.render(scene, camera);
            animId = requestAnimationFrame(animate);
        };
        const startAnimation = () => {
            if (animId !== 0 || document.hidden) return;
            previousFrame = performance.now();
            animId = requestAnimationFrame(animate);
        };
        const handleVisibilityChange = () => {
            if (document.hidden) {
                cancelAnimationFrame(animId);
                animId = 0;
            } else {
                startAnimation();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        startAnimation();

        return () => {
            cancelled = true;
            unregisterGyro();
            unregisterSwitcher();
            cancelAnimationFrame(animId);
            clearTimeout(probeTimer);
            renderer.dispose();
            geometry.dispose();
            settled.dispose();
            incoming.dispose();
            textureCache.forEach((texture) => texture.dispose());
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            window.removeEventListener('pointermove', onPointerMove);
            removeActivationListeners();
            window.removeEventListener('deviceorientation', handleOrientation, true);
            window.removeEventListener('orientationchange', handleScreenOrientation);
            window.screen?.orientation?.removeEventListener('change', handleScreenOrientation);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: -1,
                width: '100dvw',
                height: '100dvh',
                display: 'block',
            }}
        />
    );
}
