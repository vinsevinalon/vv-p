# Portfolio sky background

`SkyBackground` mounts the real-time aerial scene behind the portfolio content. The scene uses the approved cloud fly-through from prototype commit `4b88c93`. Cloud and terrain assets are in `public/aerial-sky`. The decoder comes from the installed Three.js package. The terrain imagery comes from NASA ISS photos `iss071e488809` and `iss040e091208`.

- The scene follows the mouse on desktop. On mobile it flies on its own and follows device orientation when sensor access is available. iOS can ask for permission from the portfolio’s existing Enter button.
- The day/night button switches scene lighting. The loading screen tracks the initial image requests. Terrain can switch to GPU-compressed textures after those requests.
- The canvas stays behind the page and leaves input to the portfolio. Reduced-motion mode holds the camera steady and stops flight. The original day and night panoramas serve as static fallbacks if graphics are unavailable.
- Test motion sensors on physical devices over HTTPS. Desktop browser emulation covers viewport layout.
