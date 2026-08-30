import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

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

type DeviceOrientationConstructorWithPermission = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
};

export default function SkyBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const debugGyro = new URLSearchParams(window.location.search).has('gyroDebug');
    const [gyroStatus, setGyroStatus] = useState('initializing');
    const [gyroReading, setGyroReading] = useState('');
    const [gyroActivation, setGyroActivation] = useState('');
    const [gyroPlatform, setGyroPlatform] = useState('');

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
        const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.1, 1000);

        // Equirectangular sphere
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);
        const texture = new THREE.TextureLoader().load('/360.jpg', () => {
            // Reveal only once pixels exist, so the first paint is never a black frame.
            canvas.style.opacity = '1';
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        // Equirectangular panoramas are viewed at steep glancing angles near the poles,
        // where anisotropy is the difference between crisp and smeared.
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        scene.add(new THREE.Mesh(geometry, material));

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
        // Reported on the debug badge; the ambient fallback no longer depends on it.
        let gyroUnavailable = false;

        // Desktop only: the view follows the cursor. Touch devices are gyroscope-only and
        // register no look-around gestures at all.
        let theta = 0, phi = Math.PI / 2;
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
            targetTheta = -normalizedX * 0.9;
            targetPhi = clampPhi(Math.PI / 2 + normalizedY * 0.55);
        };
        if (!isCoarsePointer) {
            window.addEventListener('pointermove', onPointerMove);
        }

        // Gyro orientation handler
        const handleOrientation = (e: DeviceOrientationEvent) => {
            if (e.beta === null || e.gamma === null) return;
            const alpha = e.alpha ?? 0;
            gyro.events += 1;
            gyro.active = true;
            setGyroStatus('sensor active');
            if (debugGyro) {
                setGyroReading(
                    `a${alpha.toFixed(0)} b${e.beta.toFixed(0)} g${e.gamma.toFixed(0)}`
                    + ` s${gyro.screenAngle} n${gyro.events}`,
                );
            }

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
        let noEventTimer = 0;
        const orientationEvent = 'DeviceOrientationEvent' in window
            ? window.DeviceOrientationEvent as DeviceOrientationConstructorWithPermission
            : null;

        const startOrientation = () => {
            if (orientationListening) return;
            orientationListening = true;
            setGyroStatus('listening for sensor data');
            gyro.screenAngle = getScreenAngle();
            window.addEventListener('deviceorientation', handleOrientation, true);
            window.addEventListener('orientationchange', handleScreenOrientation);
            window.screen?.orientation?.addEventListener('change', handleScreenOrientation);
            // Permission can succeed on a device that never emits a reading.
            noEventTimer = window.setTimeout(() => {
                if (gyro.events === 0) {
                    gyroUnavailable = true;
                    setGyroStatus('no sensor data after 3s');
                }
            }, 3000);
        };

        if (debugGyro) {
            const hasPermissionApi =
                typeof (window.DeviceOrientationEvent as DeviceOrientationConstructorWithPermission
                    | undefined)?.requestPermission === 'function';
            setGyroPlatform(
                `perm-api:${hasPermissionApi} secure:${window.isSecureContext}`
                + ` coarse:${isCoarsePointer} ${navigator.platform || 'unknown'}`,
            );
        }

        let activationCount = 0;
        const requestOrientationPermission = (trigger: string) => {
            if (
                orientationListening
                || permissionPending
                || typeof orientationEvent?.requestPermission !== 'function'
            ) return;

            permissionPending = true;
            // Whether WebKit credits this turn with transient activation is the decisive
            // datum when the request is refused.
            const active = navigator.userActivation?.isActive;
            const activationLabel = active === undefined ? 'unknown' : String(active);
            if (debugGyro) {
                setGyroActivation(`via ${trigger} act:${activationLabel} n${activationCount}`);
            }
            // Invoked synchronously so Safari still sees the transient user activation.
            const pending = orientationEvent.requestPermission();
            setGyroStatus('requesting Safari permission');
            pending
                .then((permission) => {
                    if (permission === 'granted') {
                        rememberGranted();
                        startOrientation();
                    } else {
                        gyroUnavailable = true;
                        try {
                            window.localStorage.removeItem(GRANTED_KEY);
                        } catch {
                            // Nothing cached to clear.
                        }
                        setGyroStatus('permission denied');
                    }
                })
                .catch((error: unknown) => {
                    // Safari rejects until the call originates from a real gesture.
                    setGyroStatus(error instanceof DOMException ? error.name : 'permission error');
                })
                .finally(() => {
                    permissionPending = false;
                });
        };

        // Any incidental gesture re-arms the request inside Safari's activation window.
        // These listeners never move the view; they exist only to unlock the sensor.
        // Every event WebKit credits with transient activation, so the sensor unlocks on
        // whatever the visitor happens to do first.
        const ACTIVATION_EVENTS = [
            'touchstart', 'touchend', 'pointerdown', 'pointerup',
            'mousedown', 'mouseup', 'click', 'keydown',
        ] as const;
        const onActivation = (e: Event) => {
            if (orientationListening) {
                removeActivationListeners();
                return;
            }
            activationCount += 1;
            if (debugGyro) {
                setGyroActivation(`saw ${e.type} n${activationCount}`);
            }
            requestOrientationPermission(e.type);
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

        // Enable with no interaction wherever the platform allows it. iOS Safari requires a
        // gesture on first visit only; a previously granted origin resolves immediately here.
        if (orientationEvent) {
            if (typeof orientationEvent.requestPermission === 'function') {
                addActivationListeners();
                if (wasGranted()) {
                    // Permission state is no longer "prompt", so this resolves gesture-free.
                    requestOrientationPermission('load');
                } else {
                    setGyroStatus('awaiting first gesture (iOS requirement)');
                }
            } else {
                startOrientation();
            }
        } else {
            gyroUnavailable = true;
            setGyroStatus('orientation API unavailable');
        }

        const onResize = () => {
            const nextViewport = getViewportSize();
            camera.aspect = nextViewport.width / nextViewport.height;
            camera.updateProjectionMatrix();
            renderer.setSize(nextViewport.width, nextViewport.height, false);
        };
        window.addEventListener('resize', onResize);
        window.visualViewport?.addEventListener('resize', onResize);

        // Smoothing constants are authored for 60fps, then rescaled so a 120Hz ProMotion
        // display damps at the same real-world rate rather than twice as fast.
        const smoothing = (perFrame: number, elapsed: number) =>
            1 - Math.pow(1 - perFrame, elapsed / 16.667);

        let animId = 0;
        let previousFrame = performance.now();
        const animate = (now: number) => {
            const elapsed = Math.min(now - previousFrame, 50);
            previousFrame = now;
            if (gyro.active && gyro.calibrated) {
                gyro.current.slerp(gyro.target, smoothing(0.12, elapsed));
                camera.quaternion.copy(gyro.current);
            } else if (!isCoarsePointer) {
                const ease = smoothing(0.06, elapsed);
                theta += (targetTheta - theta) * ease;
                phi += (targetPhi - phi) * ease;
                applyPointerLook();
            } else if (!reduceMotion) {
                // Runs from load on touch devices, and yields as soon as the sensor engages.
                theta -= elapsed * 0.00004;
                phi += (clampPhi(Math.PI / 2 + Math.sin(now * 0.00007) * 0.06) - phi)
                    * smoothing(0.02, elapsed);
                applyPointerLook();
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

        // Mobile GPUs reclaim contexts aggressively; without this the sky goes black for good.
        const handleContextLost = (e: Event) => {
            e.preventDefault();
            cancelAnimationFrame(animId);
            animId = 0;
        };
        const handleContextRestored = () => {
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarsePointer ? 1.5 : 2));
            onResize();
            startAnimation();
        };
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        startAnimation();

        return () => {
            cancelAnimationFrame(animId);
            clearTimeout(noEventTimer);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            texture.dispose();
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            window.removeEventListener('pointermove', onPointerMove);
            removeActivationListeners();
            window.removeEventListener('deviceorientation', handleOrientation, true);
            window.removeEventListener('orientationchange', handleScreenOrientation);
            window.screen?.orientation?.removeEventListener('change', handleScreenOrientation);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, [debugGyro]);

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: -1,
                    width: '100dvw',
                    height: '100dvh',
                    display: 'block',
                    opacity: 0,
                    transition: 'opacity 900ms ease-out',
                }}
            />
            <div
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: -1,
                    pointerEvents: 'none',
                    background:
                        'radial-gradient(ellipse at center,'
                        + ' rgba(0,0,0,0) 45%, rgba(0,0,0,0.32) 100%)',
                }}
            />
            {debugGyro && (
                <output
                    style={{
                        position: 'fixed',
                        top: 'max(12px, env(safe-area-inset-top))',
                        right: '12px',
                        zIndex: 1000,
                        maxWidth: 'calc(100vw - 24px)',
                        padding: '8px 10px',
                        background: 'rgba(0, 0, 0, 0.8)',
                        color: '#fff',
                        font: '12px monospace',
                        pointerEvents: 'none',
                    }}
                >
                    Gyroscope: {gyroStatus}
                    {gyroPlatform && <><br />{gyroPlatform}</>}
                    {gyroActivation && <><br />{gyroActivation}</>}
                    {gyroReading && <><br />{gyroReading}</>}
                </output>
            )}
        </>
    );
}
