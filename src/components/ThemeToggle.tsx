import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { readStoredTheme, storeTheme, switchSkyTo, type SkyTheme } from '../lib/skyBridge';

/**
 * Switches the panorama between the day and night skies.
 *
 * The other sky is only fetched the first time it is asked for, so the first switch waits on
 * a multi-megabyte download. The button reports that with a pulse rather than freezing.
 */
export default function ThemeToggle() {
    const [theme, setTheme] = useState<SkyTheme>(() => readStoredTheme());
    const [busy, setBusy] = useState(false);

    const next: SkyTheme = theme === 'light' ? 'dark' : 'light';

    const toggle = async () => {
        if (busy) return;
        setBusy(true);
        setTheme(next);
        storeTheme(next);
        try {
            await switchSkyTo(next);
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to the ${next} sky`}
            aria-busy={busy}
            title={`Switch to the ${next} sky`}
            style={{
                top: 'max(1rem, env(safe-area-inset-top))',
                right: 'max(1rem, env(safe-area-inset-right))',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
            }}
            className={`fixed z-50 flex h-11 w-11 items-center justify-center text-white ring-1 ring-white/40 transition-all duration-300 hover:ring-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4ECDC4] ${
                busy ? 'animate-pulse' : ''
            }`}
        >
            {theme === 'light'
                ? <Moon size={17} strokeWidth={2.25} aria-hidden="true" />
                : <Sun size={17} strokeWidth={2.25} aria-hidden="true" />}
        </button>
    );
}
