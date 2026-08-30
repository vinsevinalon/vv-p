/**
 * Bridge between the WebGL background and the loading screen.
 *
 * The panorama is fetched inside SkyBackground, but the loading screen needs its download
 * progress, and the Enter button needs to trigger the gyroscope permission request. iOS only
 * grants motion access from inside a real user gesture, so the requester has to be callable
 * synchronously from the button's click handler.
 */

type ProgressListener = (progress: number) => void;

let progress = 0;
const progressListeners = new Set<ProgressListener>();

export const setSkyProgress = (value: number) => {
    progress = Math.min(1, Math.max(0, value));
    progressListeners.forEach((listener) => listener(progress));
};

export const onSkyProgress = (listener: ProgressListener) => {
    progressListeners.add(listener);
    listener(progress);
    return () => {
        progressListeners.delete(listener);
    };
};

type GyroRequester = () => void;

let gyroRequester: GyroRequester | null = null;

export const registerGyroRequester = (requester: GyroRequester) => {
    gyroRequester = requester;
    return () => {
        if (gyroRequester === requester) gyroRequester = null;
    };
};

/** Call synchronously from a click handler; anything async loses the user activation. */
export const requestGyroNow = () => {
    gyroRequester?.();
};
