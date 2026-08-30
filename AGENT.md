# AGENT.md

Canonical instructions for AI coding agents working in this repo. `CLAUDE.md` just points here — keep this file as the single source of truth and don't duplicate guidance into tool-specific files.

## What this is

`vv-p` — Vinse Vinalon's personal portfolio site. A single-page React app whose defining feature is a full-screen interactive 360° sky panorama rendered behind the content: the view follows the cursor on desktop and the gyroscope on mobile.

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

`build.rollupOptions.output.manualChunks` splits `three` and `react` into their own chunks. three.js is ~490 kB and changes far less often than app code, so this keeps it cached across deploys. Keep the split if you touch the build config.

## Layout

```
index.html                     Vite entry; preloads /360.jpg, loads Google Fonts (Syne, Space Mono)
src/main.tsx                   React root (StrictMode)
src/App.tsx                    Page shell: SkyBackground + header/main/footer
src/index.css                  Tailwind import + :root typography; backgrounds are transparent
                               so the canvas shows through
src/components/
  SkyBackground.tsx  (443 ln)  The 360° panorama. See below — this is the only complex file.
  Header.tsx                   Name chip
  Hero.tsx                     Role chip + headline
  Projects.tsx                 Project grid — NOT currently rendered by App.tsx
public/360.jpg                 2.4 MB equirectangular panorama
```

Path alias `@/*` → `src/*` is configured in `tsconfig.json`.

### Dead/stale files — do not treat as live

- **`index.ts`** — a leftover `bun init` stub that logs `"Hello via Bun!"`. It is *not* the app entry despite being `package.json`'s `module` field. `index.html` → `src/main.tsx` is the real entry.
- **`README.md`** — still the generated `bun init` boilerplate telling you to `bun run index.ts`. Wrong for this project.
- **`build.md`** — an early aspirational plan (five design variations at `/1`–`/5`, blog, contact form, routing). Almost none of it was built; there is no router and one design. Treat it as historical intent, not a spec.
- **`tui.json`** — empty, 0 bytes.
- **`Projects.tsx`** — complete component, not mounted. Wire it into `App.tsx` if project content is wanted.
- **`SkyBackground.md`** — a useful architecture diagram, but it has drifted from the code (see below). Fix it if you change the component.

## SkyBackground — how it actually works

One `useEffect` on mount owns the entire three.js lifecycle: renderer, scene, an inside-out `SphereGeometry(500, 60, 40)` (scaled `-1` on X) textured with `/360.jpg`, a 75° `PerspectiveCamera` at the origin, the rAF loop, and full disposal on cleanup. The canvas is `position: fixed; inset: 0; z-index: -1`.

Input mode is chosen from `window.matchMedia('(pointer: coarse)')`:

- **Fine pointer (desktop)** — a `pointermove` listener maps cursor position to `theta`/`targetPhi`, eased toward the target each frame. The camera *follows the cursor*; there is no drag interaction.
- **Coarse pointer (touch)** — no look-around gestures are registered at all. The view is gyroscope-driven, with a slow ambient drift as the fallback until the sensor engages. The drift is suppressed when `prefers-reduced-motion: reduce` is set.

`deviceOrientationToQuaternion(alpha, beta, gamma, screenAngle)` implements the W3C conversion (Euler `YXZ`, then the `-√0.5` device→camera frame rotation, then the screen-angle rotation about Z). Readings land in `gyro.target`; the loop slerps `gyro.current` toward it with frame-rate-independent smoothing so motion stays smooth at any refresh rate.

### The iOS permission dance — read before touching it

This is the subtlest code in the repo and it is deliberate:

- iOS requires `requestPermission()` to be called synchronously inside a **transient user activation**. Rather than showing an "Enable Gyroscope" button, the component attaches capture-phase listeners for eight incidental gestures (`touchstart`, `touchend`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `keydown`) and fires the request on whatever the visitor happens to do first. Those listeners never move the view — they exist only to unlock the sensor, and they remove themselves once orientation is listening.
- A grant is cached in `localStorage`. On a return visit the permission state is no longer `"prompt"`, so the request resolves without a gesture and the component calls it immediately on load. A denial clears the cached key.
- **`SkyBackground.md` is out of date here** — it still describes a visible "Enable Gyroscope" button and a `window.__startGyro()` global, plus desktop mouse *drag*. Neither exists anymore. Trust the code.

### Debugging the gyroscope

Append `?gyroDebug` to the URL to render a fixed HUD showing sensor status, platform, activation state, and live readings. It is the intended way to diagnose mobile sensor problems, since you cannot open devtools easily on a phone. Its `rgba(0,0,0,0.8)` background is functional (legibility over the panorama), not decorative — leave it alone when doing styling passes.

## Conventions

- **Indentation: 4 spaces** in `.tsx`/`.ts`. Config files at the root use 2 — match the file you're in.
- **Tailwind utilities only.** No CSS modules, no styled-components, no `style` props for layout. `src/index.css` holds only the Tailwind import and `:root` typography. The exception is `SkyBackground.tsx`, which uses inline `style` objects for the canvas and debug HUD because they're positional primitives outside the layout flow.
- **Mobile-first responsive.** Base classes target small screens; layer up with `sm:` / `md:` / `lg:`. Use `dvh` not `vh` — mobile browser chrome makes `vh` wrong.
- **Backgrounds stay transparent.** `html`, `body`, `#root` and the layout containers are deliberately see-through so the panorama reads through the whole page. Recent commits stripped hard borders, panel fills, backdrop blur and drop shadows to that end. Don't reintroduce opaque panels or shadows without being asked.
- **Palette:** ink `#1A1A1A`, teal `#4ECDC4`, coral `#FF6B6B`, yellow `#FFE66D`, on white text. Fonts: Syne (display/sans) and Space Mono (`font-mono`).
- **Comments explain *why*, not *what*.** The existing ones flag browser quirks and non-obvious intent. Match that density — sparse and load-bearing.
- **Commits: Conventional Commits** (`feat:`, `fix:`, `style:`, `chore:`). Subject in the imperative, followed by a short body explaining the reasoning when the change isn't self-evident.

## Working agreements

- Verify with `bun run build` before reporting done, and say so.
- `dist/` is gitignored — never commit build output.
- Don't add dependencies for things the stack already covers. Especially: no CSS-in-JS, no animation library (CSS transitions and the rAF loop cover current needs), no router until there is more than one page.
- Don't push to `main`, force-push, or merge unless explicitly asked.
- Changes to the panorama's mobile behavior can only be validated on a real device over the HTTPS LAN URL. If you can't test it, say so plainly rather than claiming it works.
