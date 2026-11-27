import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import LoadingScreen from './LoadingScreen';

function renderForDevice(userAgent: string, platform: string, maxTouchPoints: number) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent, platform, maxTouchPoints },
        configurable: true,
    });
    try {
        return renderToStaticMarkup(<LoadingScreen />);
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else Reflect.deleteProperty(globalThis, 'navigator');
    }
}

test('avoids the full-screen blur and fade on iPhone browsers', () => {
    for (const userAgent of ['Mozilla/5.0 (iPhone) Version/26.0 Safari/604.1', 'Mozilla/5.0 (iPhone) CriOS/141.0 Mobile']) {
        const overlay = renderForDevice(userAgent, 'iPhone', 5);
        expect(overlay).not.toContain('blur(28px)');
        expect(overlay).not.toContain('duration-700');
        expect(overlay).toContain('Enter Website');
    }
});

test('uses the simpler overlay on iPadOS with a desktop user agent', () => {
    const overlay = renderForDevice('Mozilla/5.0 (Macintosh) Safari/605.1', 'MacIntel', 5);
    expect(overlay).not.toContain('blur(28px)');
});

test('keeps the blurred fade on desktop and Android', () => {
    for (const [userAgent, platform, touchPoints] of [
        ['Mozilla/5.0 (Macintosh) Safari/605.1', 'MacIntel', 0],
        ['Mozilla/5.0 (Linux; Android 16) Mobile', 'Linux armv8l', 5],
    ] as const) {
        const overlay = renderForDevice(userAgent, platform, touchPoints);
        expect(overlay).toContain('blur(28px)');
        expect(overlay).toContain('duration-700');
    }
});
