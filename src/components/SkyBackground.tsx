import { useEffect, useRef, useState } from 'react';
import {
    readStoredTheme,
    registerGyroRequester,
    registerSkySwitcher,
    setSkyProgress,
    SKY_SOURCES,
} from '../lib/skyBridge';

export default function SkyBackground() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [theme, setTheme] = useState(readStoredTheme);
    const [showFallback, setShowFallback] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let cancelled = false;
        let canvas: HTMLCanvasElement | null = null;
        let sky: ReturnType<typeof import('../lib/aerialSky/createAerialSky').createAerialSky> | null = null;
        const handleContextLoss = () => setShowFallback(true);
        const handleContextRestore = () => setShowFallback(false);

        const unregisterSwitcher = registerSkySwitcher((next) => {
            setTheme(next);
            sky?.setTheme(next);
        });
        const unregisterGyro = registerGyroRequester(() => sky?.requestGyroPermission());

        setSkyProgress(0);
        void import('../lib/aerialSky/createAerialSky')
            .then(({ createAerialSky }) => {
                if (cancelled) return;

                sky = createAerialSky(container, {
                    initialTheme: readStoredTheme(),
                    onProgress: setSkyProgress,
                });
                canvas = container.querySelector('canvas');
                canvas?.addEventListener('webglcontextlost', handleContextLoss);
                canvas?.addEventListener('webglcontextrestored', handleContextRestore);
            })
            .catch(() => {
                if (cancelled) return;
                setShowFallback(true);
                setSkyProgress(1);
            });

        return () => {
            cancelled = true;
            unregisterSwitcher();
            unregisterGyro();
            canvas?.removeEventListener('webglcontextlost', handleContextLoss);
            canvas?.removeEventListener('webglcontextrestored', handleContextRestore);
            sky?.dispose();
        };
    }, []);

    return (
        <div
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 -z-10 h-dvh w-dvw overflow-hidden bg-[#152942] after:absolute after:inset-0 after:bg-[linear-gradient(180deg,rgba(5,13,25,0.4),transparent_28%,transparent_42%,rgba(5,13,25,0.85))]"
            style={{
                backgroundImage: showFallback ? `url(${SKY_SOURCES[theme]})` : undefined,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
            }}
        >
            <div ref={containerRef} className={`h-full w-full ${showFallback ? 'invisible' : ''}`} />
        </div>
    );
}
