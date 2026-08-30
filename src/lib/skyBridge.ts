/**
 * Bridge between the WebGL background and the UI around it.
 *
 * The panorama is fetched inside SkyBackground, but the loading screen needs its download
 * progress, the Enter button needs to trigger the gyroscope permission request, and the theme
 * toggle needs to swap panoramas. iOS only grants motion access from inside a real user
 * gesture, so the gyro requester has to be callable synchronously from a click handler.
 */

export type SkyTheme = 'light' | 'dark';

export const SKY_SOURCES: Record<SkyTheme, string> = {
    light: '/360.jpg',
    dark: '/360-night-sky.jpg',
};

const THEME_KEY = 'skyTheme';

/** Stored choice wins; otherwise follow the visitor's system preference. */
export const readStoredTheme = (): SkyTheme => {
    try {
        const stored = window.localStorage.getItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        // Private mode; fall through to the system preference.
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const storeTheme = (theme: SkyTheme) => {
    try {
        window.localStorage.setItem(THEME_KEY, theme);
    } catch {
        // Private mode; the choice simply lasts for this visit.
    }
};

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

type SkySwitcher = (theme: SkyTheme) => Promise<void> | void;

let skySwitcher: SkySwitcher | null = null;

export const registerSkySwitcher = (switcher: SkySwitcher) => {
    skySwitcher = switcher;
    return () => {
        if (skySwitcher === switcher) skySwitcher = null;
    };
};

export const switchSkyTo = async (theme: SkyTheme) => {
    await skySwitcher?.(theme);
};
