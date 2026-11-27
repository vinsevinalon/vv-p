import * as THREE from 'three';
import type { GyroStatus } from './types';

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const DEG2RAD = Math.PI / 180;
const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

function getVerticalFov(aspect: number): number {
  // Open up the view on narrow phone and foldable cover screens.
  if (aspect < 0.43) return 76;
  if (aspect < 0.65) return THREE.MathUtils.lerp(76, 66, (aspect - 0.43) / 0.22);
  if (aspect < 1.25) return THREE.MathUtils.lerp(66, 58, (aspect - 0.65) / 0.6);
  return THREE.MathUtils.clamp(THREE.MathUtils.lerp(58, 52, (aspect - 1.25) / 0.6), 50, 58);
}

export class AerialCameraRig {
  readonly camera: THREE.PerspectiveCamera;

  // Default high-cruise pitch: -13.5 deg downward so deep ozone fills upper third,
  // layered clouds span middle, and land peeks through below (Photos 2 & 4)
  private readonly defaultPitch = -13.5 * DEG2RAD;
  private readonly defaultYaw = 0;

  private currentYaw = 0;
  private currentPitch = -13.5 * DEG2RAD;

  private mouseNdcX = 0;
  private mouseNdcY = 0;

  // Gyro quaternion state
  private gyroStatus: GyroStatus = 'inactive';
  private disposed = false;
  private gyroEnabled = false;
  private hasGyroReading = false;
  private gyroQuat = new THREE.Quaternion();
  private gyroSmoothQuat = new THREE.Quaternion();
  private gyroBaseQuat = new THREE.Quaternion();
  private hasGyroBaseline = false;
  private lastHeading = 0;
  private screenAngle = 0;

  // Reusable math scratch objects (zero per-frame GC allocations!)
  private readonly eulerTmp = new THREE.Euler();
  private readonly q0Tmp = new THREE.Quaternion();
  private readonly qFinalTmp = new THREE.Quaternion();
  private readonly qDefaultTmp = new THREE.Quaternion();

  private currentFov = 56;
  private targetFov = 56;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.5, 1600);
    this.camera.position.set(0, 0, 0);

    this.detectInitialGyroSupport();
    this.updateScreenOrientation();
    this.bindEvents();
  }

  private detectInitialGyroSupport() {
    const isTouchDevice =
      typeof navigator !== 'undefined' &&
      (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer: coarse)').matches));

    if (!isTouchDevice || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.setGyroStatus('unsupported');
      return;
    }

    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (typeof DOE.requestPermission === 'function') {
      this.setGyroStatus('needs-permission');
      this.attachGyroListener();
      // Safari can confirm an existing grant without prompting on arrival.
      void this.requestGyroPermission();
    } else {
      // Android Chrome / Foldables: listen automatically over HTTPS, mark active on first valid event
      this.setGyroStatus('inactive');
      this.attachGyroListener();
    }
  }

  private setGyroStatus(status: GyroStatus) {
    if (this.gyroStatus === status) return;
    this.gyroStatus = status;
  }

  getGyroStatus(): GyroStatus {
    return this.gyroStatus;
  }

  /** Safari needs a real tap to show a prompt for a new grant. */
  async requestGyroPermission(): Promise<GyroStatus> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.setGyroStatus('unsupported');
      return this.gyroStatus;
    }

    const DOE = window.DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (this.disposed) return this.gyroStatus;
        if (res === 'granted') {
          this.attachGyroListener();
          this.setGyroStatus('active');
        } else if (!this.hasGyroReading) {
          this.setGyroStatus('denied');
        }
      } catch {
        // A cold visit can reject without a gesture. Keep the Enter tap available.
      }
      return this.gyroStatus;
    }

    // Non-iOS: enable / recenter gyro
    this.hasGyroBaseline = false;
    this.attachGyroListener();
    this.setGyroStatus(this.hasGyroReading ? 'active' : 'inactive');
    return this.gyroStatus;
  }

  private attachGyroListener() {
    if (this.gyroEnabled) return;
    this.gyroEnabled = true;
    window.addEventListener('deviceorientation', this.handleDeviceOrientation, { passive: true });
  }

  private handleDeviceOrientation = (ev: DeviceOrientationEvent) => {
    if (ev.beta === null || ev.gamma === null) return;

    // Tilt is usable even if the browser has no heading for this reading.
    if (ev.alpha !== null) this.lastHeading = ev.alpha;
    const alpha = this.lastHeading * DEG2RAD;
    const beta = ev.beta * DEG2RAD;
    const gamma = ev.gamma * DEG2RAD;
    const orient = this.screenAngle * DEG2RAD;

    // Standard W3C DeviceOrientation -> Three.js camera quaternion (YXZ intrinsic, zero gimbal lock)
    this.eulerTmp.set(beta, alpha, -gamma, 'YXZ');
    this.gyroQuat.setFromEuler(this.eulerTmp);
    this.gyroQuat.multiply(Q1); // Camera looks out the back of the device
    this.q0Tmp.setFromAxisAngle(ZEE, -orient);
    this.gyroQuat.multiply(this.q0Tmp);

    if (!this.hasGyroBaseline) {
      // Calibrate initial holding angle to our default high-cruise pitch (-13.5 deg)
      // so holding a phone comfortably in your hand immediately shows ozone + clouds + land!
      this.qDefaultTmp.setFromEuler(new THREE.Euler(this.defaultPitch, this.defaultYaw, 0, 'YXZ'));
      // base * gyro0 = default  =>  base = default * inv(gyro0)
      this.gyroBaseQuat.copy(this.qDefaultTmp).multiply(this.q0Tmp.copy(this.gyroQuat).invert());
      this.gyroSmoothQuat.copy(this.qDefaultTmp);
      this.hasGyroBaseline = true;
    }

    this.hasGyroReading = true;
    if (this.gyroStatus !== 'active') {
      this.setGyroStatus('active');
    }
  };

  private updateScreenOrientation = () => {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
      this.screenAngle = screen.orientation.angle;
    } else if (typeof window !== 'undefined' && typeof (window as unknown as { orientation?: number }).orientation === 'number') {
      this.screenAngle = (window as unknown as { orientation: number }).orientation;
    } else {
      this.screenAngle = 0;
    }
  };

  private handlePointerMove = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse') return;
    this.mouseNdcX = (ev.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
    this.mouseNdcY = (ev.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
  };

  private bindEvents() {
    window.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    window.addEventListener('orientationchange', this.updateScreenOrientation, { passive: true });
    screen.orientation?.addEventListener?.('change', this.updateScreenOrientation);
  }

  resize(width: number, height: number, immediate = false) {
    this.camera.aspect = width / Math.max(height, 1);
    this.targetFov = getVerticalFov(this.camera.aspect);

    if (immediate) {
      this.currentFov = this.targetFov;
      this.camera.fov = this.targetFov;
    }
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, reducedMotion: boolean) {
    // Smooth zero-bounce exponential damping (MOT-02)
    const smooth = 1 - Math.exp(-Math.min(dt, 0.1) * 9.5);

    if (Math.abs(this.currentFov - this.targetFov) > 0.02) {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, this.targetFov, smooth);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    if (reducedMotion) {
      this.eulerTmp.set(this.defaultPitch, this.defaultYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(this.eulerTmp);
      this.camera.updateMatrixWorld();
      return;
    }

    if (this.hasGyroReading && this.hasGyroBaseline) {
      this.qFinalTmp.copy(this.gyroBaseQuat).multiply(this.gyroQuat);
      this.gyroSmoothQuat.slerp(this.qFinalTmp, 1 - Math.exp(-Math.min(dt, 0.1) * 14.0));
      this.camera.quaternion.copy(this.gyroSmoothQuat);
    } else {
      this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, this.defaultYaw - this.mouseNdcX * 0.16, smooth);
      this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, this.defaultPitch - this.mouseNdcY * 0.09, smooth);
      this.eulerTmp.set(this.currentPitch, this.currentYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(this.eulerTmp);
    }

    this.camera.updateMatrixWorld();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('orientationchange', this.updateScreenOrientation);
    screen.orientation?.removeEventListener?.('change', this.updateScreenOrientation);
    if (this.gyroEnabled) {
      window.removeEventListener('deviceorientation', this.handleDeviceOrientation);
    }
  }
}
