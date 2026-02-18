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
    screenOrientation: number,
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
    q.multiply(q0.setFromAxisAngle(zee, -THREE.MathUtils.degToRad(screenOrientation)));
    return q;
}

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const needsPermission = typeof (DeviceOrientationEvent as any).requestPermission === 'function';

export default function SkyBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // showButton: only shown on iOS where explicit permission is required
    const [showButton, setShowButton] = useState(isMobile && needsPermission);
    const [gyroActive, setGyroActive] = useState(false);

    // Refs for Three.js objects shared between setup and gyro handler
    const gyroRef = useRef({
        enabled: false,
        initialized: false,
        current: new THREE.Quaternion(),
        target: new THREE.Quaternion(),
        screenOrientation: 0 as number,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        // Equirectangular sphere
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);
        const texture = new THREE.TextureLoader().load('/360.jpg');
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        scene.add(new THREE.Mesh(geometry, material));

        // Desktop drag state
        let isDragging = false;
        let lastX = 0, lastY = 0;
        let theta = 0, phi = Math.PI / 2;
        const clampPhi = (p: number) => Math.max(0.05, Math.min(Math.PI - 0.05, p));

        const applyDrag = () => {
            camera.lookAt(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta),
            );
        };
        applyDrag();

        const onMouseDown = (e: MouseEvent) => { isDragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; };
        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            theta -= (e.clientX - lastX) * 0.003;
            phi = clampPhi(phi + (e.clientY - lastY) * 0.003);
            lastX = e.clientX; lastY = e.clientY;
            applyDrag();
        };
        const onMouseUp = () => { isDragging = false; canvas.style.cursor = 'grab'; };

        if (!isMobile) {
            window.addEventListener('mousedown', onMouseDown);
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        }

        // Gyro orientation handler
        const handleOrientation = (e: DeviceOrientationEvent) => {
            if (e.alpha === null || e.beta === null || e.gamma === null) return;
            const g = gyroRef.current;
            const q = deviceOrientationToQuaternion(e.alpha, e.beta, e.gamma, g.screenOrientation);

            if (!g.initialized) {
                // Snap to first reading instantly — no lerp from identity
                g.current.copy(q);
                g.initialized = true;
            }
            g.target.copy(q);
            g.enabled = true;
        };

        const handleScreenOrientation = () => {
            gyroRef.current.screenOrientation = (window.orientation as number) ?? 0;
        };

        // For Android / non-iOS: start gyro immediately without permission prompt
        if (isMobile && !needsPermission) {
            gyroRef.current.screenOrientation = (window.orientation as number) ?? 0;
            window.addEventListener('deviceorientation', handleOrientation, true);
            window.addEventListener('orientationchange', handleScreenOrientation);
            setGyroActive(true);
            setShowButton(false);
        }

        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);

        let animId: number;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            const g = gyroRef.current;
            if (g.enabled && g.initialized) {
                g.current.slerp(g.target, 0.1);
                camera.quaternion.copy(g.current);
            }
            renderer.render(scene, camera);
        };
        animate();

        // Expose orientation handler so the button can start it
        (window as any).__startGyro = () => {
            gyroRef.current.screenOrientation = (window.orientation as number) ?? 0;
            window.addEventListener('deviceorientation', handleOrientation, true);
            window.addEventListener('orientationchange', handleScreenOrientation);
        };

        return () => {
            cancelAnimationFrame(animId);
            renderer.dispose();
            geometry.dispose();
            material.dispose();
            texture.dispose();
            window.removeEventListener('resize', onResize);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('deviceorientation', handleOrientation);
            window.removeEventListener('orientationchange', handleScreenOrientation);
            delete (window as any).__startGyro;
        };
    }, []);

    // iOS permission button handler — must be called directly from a tap
    const requestPermission = async () => {
        try {
            const perm = await (DeviceOrientationEvent as any).requestPermission();
            if (perm === 'granted') {
                (window as any).__startGyro?.();
                setGyroActive(true);
            }
        } catch (err) {
            console.warn('Gyro permission denied', err);
        } finally {
            setShowButton(false);
        }
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: -1,
                    width: '100vw',
                    height: '100vh',
                    display: 'block',
                    cursor: isMobile ? 'default' : 'grab',
                }}
            />
            {showButton && (
                <button
                    onClick={requestPermission}
                    style={{
                        position: 'fixed',
                        bottom: '24px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 100,
                        background: '#1A1A1A',
                        color: '#FFE66D',
                        border: '2px solid #FFE66D',
                        padding: '10px 20px',
                        fontFamily: 'monospace',
                        fontWeight: 'bold',
                        fontSize: '12px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        boxShadow: '3px 3px 0 #FFE66D',
                    }}
                >
                    ⟳ Enable Gyroscope
                </button>
            )}
        </>
    );
}
