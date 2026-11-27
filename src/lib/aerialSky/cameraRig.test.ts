import { afterEach, beforeEach, expect, test } from 'bun:test';
import { AerialCameraRig } from './cameraRig';

class TestOrientationEvent extends Event {
    static requestPermission = async (): Promise<'granted' | 'denied'> => 'granted';

    constructor(
        readonly alpha: number | null,
        readonly beta: number | null,
        readonly gamma: number | null,
    ) {
        super('deviceorientation');
    }
}

let mockWindow: EventTarget;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const rigs: AerialCameraRig[] = [];

beforeEach(() => {
    mockWindow = new EventTarget();
    const globals = {
        window: Object.assign(mockWindow, { DeviceOrientationEvent: TestOrientationEvent }),
        navigator: { userAgent: 'iPhone', maxTouchPoints: 5 },
        screen: { orientation: { angle: 0 } },
    };
    for (const [name, value] of Object.entries(globals)) {
        descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { value, configurable: true });
    }
});

afterEach(() => {
    rigs.splice(0).forEach((rig) => rig.dispose());
    for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    }
    descriptors.clear();
});

test('checks previously granted Safari motion permission on arrival', async () => {
    let requests = 0;
    TestOrientationEvent.requestPermission = async () => {
        requests++;
        return 'granted';
    };
    const rig = new AerialCameraRig();
    rigs.push(rig);

    await Promise.resolve();
    expect(requests).toBe(1);
    expect(rig.getGyroStatus()).toBe('active');
});

test('keeps the tap available when Safari requires user activation', async () => {
    let hasGesture = false;
    TestOrientationEvent.requestPermission = async () => {
        if (!hasGesture) throw new DOMException('User activation required', 'NotAllowedError');
        return 'granted';
    };
    const rig = new AerialCameraRig();
    rigs.push(rig);

    await Promise.resolve();
    expect(rig.getGyroStatus()).toBe('needs-permission');
    hasGesture = true;
    expect(await rig.requestGyroPermission()).toBe('active');
});

test('follows device tilt when Safari does not report a compass heading', () => {
    TestOrientationEvent.requestPermission = async () => 'granted';
    const rig = new AerialCameraRig();
    rigs.push(rig);

    rig.update(0.1, false);
    const initial = rig.camera.quaternion.clone();
    mockWindow.dispatchEvent(new TestOrientationEvent(null, 45, 0));
    mockWindow.dispatchEvent(new TestOrientationEvent(null, 60, 15));
    rig.update(0.1, false);

    expect(rig.camera.quaternion.angleTo(initial)).toBeGreaterThan(0.1);
});
