# AGENT.md

Canonical instructions for AI coding agents working in this repo. `CLAUDE.md` just points here — keep this file as the single source of truth and don't duplicate guidance into tool-specific files.

## What this is

`vv-p` — Vinse Vinalon's personal portfolio site. A single-page React app whose defining feature is a full-screen 360° sky panorama rendered behind the content: the view follows the cursor on desktop and the gyroscope on mobile, and a toggle cross-fades between a day and a night sky.

It is a static frontend. There is no backend, no database, no API.

## Stack

| Concern | Choice |
| --- | --- |
| Runtime / package manager | Bun (`bun.lock`) |
| Build tool & dev server | Vite 7 (`@vitejs/plugin-react-swc`) |
| UI | React 19 |
| Language | TypeScript 5 (`strict: true`, `noEmit`) |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` |
| 3D | three.js |
| Icons | lucide-react |

## Commands

```bash
bun install          # install dependencies
bun run dev          # Vite dev server on https://localhost:4000
bun run build        # tsc && vite build → dist/  (tsconfig sets noEmit, so tsc only type-checks)
bun run preview      # serve the production build
```

`bun run build` is the check to run before calling work done — it type-checks *and* bundles. There is no test suite and no linter configured; don't invent commands for either.

**Gotcha:** `bun` is not always on `PATH` in non-interactive/agent shells even though it is the project's package manager. If `bun: command not found`, fall back to `npm run <script>` — the scripts are plain Vite/tsc invocations and behave identically. Do not "fix" this by rewriting scripts or committing a `package-lock.json`; `bun.lock` is the lockfile of record.

**Gotcha:** when working from a git worktree, `node_modules` lives only in the main checkout. Symlink it rather than reinstalling:
`ln -s /path/to/main/checkout/node_modules ./node_modules` (remove the symlink before committing).

## Dev server specifics

Three settings in `vite.config.ts` exist for concrete reasons — don't strip them:

- **`basicSsl()`** — serves dev over HTTPS. iOS Safari only exposes `DeviceOrientationEvent.requestPermission()` in a secure context, so the gyroscope cannot be tested over plain HTTP. The cert is self-signed; you must accept the browser warning, on the phone too.
- **`server.host: true`** — exposes the dev server on the LAN so a real phone can hit it. Mobile behavior cannot be verified in a desktop browser's device emulator; the sensor events aren't synthesized.
- **`server.port: 4000`** — fixed so the accepted cert exception and bookmarked LAN URL stay valid.

`build.rollupOptions.output.manualChunks` splits `three` and `react` into their own chunks. three.js is ~485 kB and changes far less often than app code, so this keeps it cached across deploys. Keep the split if you touch the build config.

## Layout

```
index.html                     Vite entry; loads Google Fonts (Syne, Space Mono)
src/main.tsx                   React root (StrictMode)
src/App.tsx                    Page shell: SkyBackground + LoadingScreen + ThemeToggle,
                               then header/main/footer
src/index.css                  Tailwind import + :root typography; backgrounds are transparent
                               so the canvas shows through
src/lib/
  skyBridge.ts                 Module-level bridge between the WebGL layer and the UI
src/components/
  SkyBackground.tsx  (475 ln)  The 360° panorama. The one genuinely complex file — see below.
  LoadingScreen.tsx            Download progress + the Enter gate that unlocks the gyroscope
  ThemeToggle.tsx              Day/night sky switch (top-right)
  Header.tsx                   Name
  Hero.tsx                     Role label, blurb, capability tags
  Projects.tsx                 Project grid — NOT currently rendered by App.tsx
public/
  360.jpg                      2.4 MB equirectangular day panorama
  360-night-sky.jpg            2.8 MB equirectangular night panorama
```

Path alias `@/*` → `src/*` is configured in `tsconfig.json`.

### Dead/stale files — do not treat as live

- **`index.ts`** — a leftover `bun init` stub that logs `"Hello via Bun!"`. It is *not* the app entry despite being `package.json`'s `module` field. `index.html` → `src/main.tsx` is the real entry.
- **`README.md`** — still the generated `bun init` boilerplate telling you to `bun run index.ts`. Wrong for this project.
- **`build.md`** — an early aspirational plan (five design variations at `/1`–`/5`, blog, contact form, routing). Almost none of it was built; there is no router and one design. Treat it as historical intent, not a spec.
- **`tui.json`** — empty, 0 bytes.
- **`Projects.tsx`** — complete component, not mounted. Wire it into `App.tsx` if project content is wanted.
- **`SkyBackground.md`** — an architecture diagram that has drifted badly from the code. It describes an "Enable Gyroscope" button, a `window.__startGyro()` global, desktop mouse *drag*, and a single sphere — none of which exist now. Trust the code; rewrite or delete the doc if you touch the component.

## Architecture: the sky bridge

`SkyBackground` owns the WebGL layer, but three pieces of UI outside it need in: the loading screen needs download progress, the Enter button needs to trigger the gyro permission request, and the theme toggle needs to swap panoramas. `src/lib/skyBridge.ts` is a small module-level registry that wires them without prop-drilling or context:

- `setSkyProgress` / `onSkyProgress` — a 0–1 progress channel the loading screen subscribes to.
- `registerGyroRequester` / `requestGyroNow` — **must stay synchronously callable from a click handler.** iOS only grants motion access inside a genuine user gesture, and any `await` before the call loses the activation. This is why it's an imperative registry and not a promise-returning API.
- `registerSkySwitcher` / `switchSkyTo` — theme swap, awaited so the toggle can show a busy state.
- `readStoredTheme` / `storeTheme` — `localStorage` key `skyTheme`, falling back to `prefers-color-scheme`.

All `localStorage` access is wrapped in try/catch for private mode. Keep it that way.

## SkyBackground — how it actually works

One `useEffect` on mount owns the entire three.js lifecycle and disposes everything on cleanup. The canvas is `position: fixed; inset: 0; z-index: -1`.

**Two stacked spheres, not one.** Both use the same inside-out `SphereGeometry(500, 60, 40)` (scaled `-1` on X) with `transparent` materials, `depthTest: false`, `depthWrite: false`, and explicit `renderOrder`. A theme change fades `incoming` in over `settled` across 650 ms instead of cutting. Depth testing is off deliberately — two coincident spheres would otherwise z-fight.

**Panorama loading is a streaming `fetch`, not `TextureLoader`.** It reads `content-length`, pumps the body reader, and reports byte progress so the loading bar is real rather than faked. The last percent is held back until the image actually decodes. Decoded images are cached per theme in a module-level map, so the second theme downloads once and switches instantly thereafter. A failed fetch resolves progress to 1 and returns `null` — never trap the visitor behind the loader.

**Texture mipmapping is conditional.** A non-power-of-two texture with a mipmap `minFilter` renders black under WebGL1 and on stricter mobile drivers, so mipmaps, `LinearMipmapLinearFilter`, and anisotropy are only enabled when both dimensions are powers of two. Don't unconditionally "optimize" this.

Input mode comes from `window.matchMedia('(pointer: coarse)')`:

- **Fine pointer (desktop)** — a `pointermove` listener maps cursor position to target angles, eased each frame. The camera *follows the cursor*; there is no drag interaction.
- **Coarse pointer (touch)** — no look-around gestures are registered at all. The view is gyroscope-driven, with a slow ambient drift as the fallback until the sensor engages. The drift is suppressed under `prefers-reduced-motion: reduce`.

`deviceOrientationToQuaternion(alpha, beta, gamma, screenAngle)` implements the W3C conversion (Euler `YXZ`, the `-√0.5` device→camera frame rotation, then the screen-angle rotation about Z). Readings land in `gyro.target`; the loop slerps toward it with frame-rate-independent smoothing so motion stays smooth at any refresh rate. Gyro state is scoped inside the effect so a StrictMode remount can't leave a stale handler calibrating against a disposed camera.

### The iOS permission dance — read before touching it

This is the subtlest code in the repo and every part of it is load-bearing:

- **Listen first, ask later.** `deviceorientation` is subscribed unconditionally *before* any permission request. The permission gate is not the only path to sensor data — with Settings → Safari → Motion & Orientation Access enabled, and in Home Screen web apps, WebKit delivers events with no `requestPermission()` call at all. Asking first suppresses that path. A 700 ms probe timer then checks whether real events arrived.
- **The Enter button is the permission gesture.** `LoadingScreen`'s Enter click calls `requestGyroNow()` synchronously — that click is doing real work beyond dismissing the loader, and it is the one moment iOS reliably accepts the request on a first visit.
- **Incidental gestures are a fallback.** Capture-phase listeners on eight events (`touchstart`, `touchend`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `keydown`) re-arm the request if Enter didn't manage it. They never move the view. Because the listen-first strategy means a listener is always attached, "already listening" proves nothing — only `gyro.events > 0` means real sensor data arrived, and that's the condition that tears the fallback down.
- **A grant is cached** in `localStorage` under `skyGyroGranted`, so return visits resolve without a gesture. A denial clears it.

There is no on-screen debug HUD; the `?gyroDebug` overlay that used to exist has been removed.

## Conventions

- **Indentation: 4 spaces** in `.tsx`/`.ts`. Config files at the root use 2 — match the file you're in.
- **Tailwind utilities for layout and styling.** No CSS modules, no styled-components. `src/index.css` holds only the Tailwind import and `:root` typography. Inline `style` objects are used sparingly and only for things Tailwind can't express well: the fixed canvas, `env(safe-area-inset-*)` offsets, `backdropFilter` with its `-webkit-` twin, and `100dvw/100dvh` sizing.
- **Mobile-first responsive.** Base classes target small screens; layer up with `sm:` / `md:` / `lg:`. Use `dvh` not `vh` — mobile browser chrome makes `vh` wrong.
- **The sky stays visible.** `html`, `body`, `#root` and the layout containers are deliberately transparent, and successive commits stripped hard borders, panel fills, and drop shadows to that end. Don't reintroduce opaque panels or text shadows on the content layer without being asked. The two exceptions are intentional and use **blur, not fill**: the loading screen's `backdrop-filter` (no background colour, so the live sky shows through while it loads) and the theme toggle's blurred ring.
- **`inset-0` is wrong for full-viewport overlays here.** A fixed element resolves against the viewport minus the scrollbar and leaves a sliver of sky uncovered; the loading screen uses `left/top: 0` with explicit `100dvw × 100dvh` instead. Match that if you add another overlay.
- **Palette:** ink `#1A1A1A`, teal `#4ECDC4` (accent, focus rings, progress bar), coral `#FF6B6B`, yellow `#FFE66D`, on white text. Fonts: Syne (display/sans) and Space Mono (`font-mono`).
- **Accessibility is already wired** — `role="dialog"`/`aria-modal` on the loader, a real `progressbar` with `aria-valuenow`, focus moved to Enter as it appears, `aria-label`/`aria-busy` on the toggle, and `focus-visible` rings throughout. Don't regress it.
- **Comments explain *why*, not *what*.** The existing ones flag browser quirks and non-obvious intent. Match that density — sparse and load-bearing.
- **Commits: Conventional Commits** (`feat:`, `fix:`, `style:`, `perf:`, `chore:`, `docs:`). Subject in the imperative, followed by a short body explaining the reasoning when the change isn't self-evident.

## Working agreements

- Verify with `bun run build` before reporting done, and say so.
- `dist/` is gitignored — never commit build output.
- Don't add dependencies for things the stack already covers. Especially: no CSS-in-JS, no animation library (CSS transitions and the rAF loop cover current needs), no router until there is more than one page.
- Don't push to `main`, force-push, or merge unless explicitly asked.
- Changes to the panorama's mobile behavior can only be validated on a real device over the HTTPS LAN URL. If you can't test it, say so plainly rather than claiming it works.
