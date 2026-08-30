import { useEffect, useRef, useState } from 'react';
import { onSkyProgress, requestGyroNow } from '../lib/skyBridge';

/**
 * Covers the page while the panorama downloads, then hands over on a deliberate click.
 *
 * That click is doing real work beyond navigation: iOS only grants motion-sensor access from
 * inside a genuine user gesture, so entering the site is what unlocks the gyroscope. Nothing
 * else on the page can do it, and no scripted event qualifies.
 */
export default function LoadingScreen() {
    const [progress, setProgress] = useState(0);
    const [entering, setEntering] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [stalled, setStalled] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => onSkyProgress(setProgress), []);

    // A wedged download must never strand the visitor on this screen.
    useEffect(() => {
        const timer = window.setTimeout(() => setStalled(true), 15000);
        return () => clearTimeout(timer);
    }, []);

    const ready = progress >= 1 || stalled;

    // Move focus to the button as it appears, so keyboard entry works without hunting.
    useEffect(() => {
        if (ready) buttonRef.current?.focus();
    }, [ready]);

    if (dismissed) return null;

    const enter = () => {
        // Synchronous, inside the click: anything awaited first loses the user activation.
        requestGyroNow();
        setEntering(true);
        window.setTimeout(() => setDismissed(true), 700);
    };

    const percent = Math.round(progress * 100);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Loading"
            // Sized like the canvas rather than with inset-0: a fixed element resolves against
            // the viewport minus the scrollbar, which leaves a sliver of sky uncovered.
            // Blur only, no fill, so the live sky stays visible behind the loader.
            style={{
                width: '100dvw',
                height: '100dvh',
                backdropFilter: 'blur(28px) saturate(115%)',
                WebkitBackdropFilter: 'blur(28px) saturate(115%)',
            }}
            className={`fixed left-0 top-0 z-[9999] flex items-center justify-center transition-opacity duration-700 ease-out ${
                entering ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
        >
            <div className="w-full max-w-[19rem] px-6 sm:max-w-sm">
                <div
                    className="h-px w-full overflow-hidden bg-white/40"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                >
                    <div
                        className="h-full bg-[#4ECDC4] transition-[width] duration-200 ease-out"
                        style={{ width: `${percent}%` }}
                    />
                </div>

                <div
                    className="mt-3 flex justify-end font-mono text-[10px] uppercase tracking-[0.2em] text-white"
                    style={{ textShadow: '0 1px 3px rgba(26,26,26,0.55)' }}
                >
                    <span className="tabular-nums">{percent}%</span>
                </div>

                <div className="mt-12 h-12">
                    <button
                        ref={buttonRef}
                        type="button"
                        onClick={enter}
                        className={`h-12 w-full bg-white font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-[#1A1A1A] transition-all duration-500 hover:bg-[#4ECDC4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4ECDC4] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
                            ready ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
                        }`}
                    >
                        Enter Website
                    </button>
                </div>
            </div>
        </div>
    );
}
