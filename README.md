# Air View

A single-page web experience that renders Earth as frosted glass and every
aircraft currently in the sky as a luminous point. Live ADS-B, no UI chrome,
zero-allocation render loop.

🚀 **Live:** <https://air-view-production.up.railway.app/>

License: TBD

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript strict, Vite 5 |
| 3D | Three.js 0.160 (raw, no R3F) + custom GLSL shaders |
| Backend | Fastify 5 on Node 20 + @fastify/static + @fastify/cors |
| Data | [adsb.lol](https://adsb.lol) live ADS-B aggregator (no auth, no key) |
| State | Zustand stores (framework-agnostic) |
| Testing | Vitest (50 unit + component) + Playwright e2e + axe-core a11y |
| Deploy | Railway, single service, NIXPACKS build |

---

## Architecture

A single Fastify process serves both `/api/states` (proxies adsb.lol with a
15 s bbox-keyed cache) and the Vite production build statically from `dist/`.
The frontend runs a zero-allocation render loop: one `LineSegments` for all
trails and one `Points` cloud for all aircraft, both backed by 18 000-slot
pre-allocated `Float32Array` buffers and updated with `setDrawRange` +
`needsUpdate`. Adaptive refresh — 30 s active / 60 s idle / 120 s
background — keeps OpenSky-equivalent server load light. Bbox-driven
filtering plumbing is in place but currently bypassed (global fetch); it
becomes camera-driven in v2.

---

## Known limitations

- **Antipodal ring uncovered.** adsb.lol's largest radius is 10 000 NM around
  any centre; Earth's max geodesic is ~10 800 NM, so a thin ring on the far
  side of (0, 0) — mostly empty South Pacific — is missing.
- **Route & destination accuracy is imperfect.** Route lookup falls back to
  OpenFlights' static `routes.dat` because adsb.lol doesn't ship scheduled
  flight data. Charter, ferry, and military callsigns often resolve to
  "Route unknown".
- **Static global fetch.** v1 always pulls the full feed (~9 000 aircraft).
  Aircraft outside the camera frustum still travel down the wire.

---

## Roadmap

- **v2 — camera-driven bbox.** Derive a centre+radius from the camera
  viewpoint with a buffer ring, fetching only the visible region.
- **Better airport / route resolution.** Either a paid scheduled-flight API
  or a curated dataset for the top N busy callsigns.
- **Secondary data source.** Fail over to adsb.fi or similar when adsb.lol
  rate-limits a region.
- **Mobile polish.** Side panel becomes a bottom sheet, touch controls
  retuned for one-finger pan + pinch zoom.

---

## Local development

```bash
git clone <repo>
cd air-view
npm install
node scripts/build-static-data.mjs   # one-time: pulls Natural Earth, OpenFlights, OurAirports
cp .env.example .env                 # PORT, optional FRONTEND_ORIGIN
npm run dev:full                     # vite on :5173 + fastify on :3000
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the Fastify server.

```bash
npm test          # Vitest unit + component (50 tests)
npm run test:e2e  # Playwright + axe-core (needs: npx playwright install chromium)
npm run build:all # vite build + tsc -p tsconfig.server.json
```

---

## Deploy

Railway auto-deploys on every push to `main`. Manual:

```bash
railway login
railway link
railway up
```

`railway.toml` runs `npm run build:all` (vite → `dist/`, tsc → `dist-server/`)
then `npm run start`. `PORT` is injected by Railway; `/health` is the
healthcheck. Node 20+ is pinned via `package.json#engines` and `.nvmrc`.

---

## Project layout

```
src/
├── globe/    Three.js scene — frosted glass shader, aircraft SDF + trails buffer pool,
│             leader line projection, raycaster (a11y hit zones)
├── data/     adsb.lol source, route + airport + airline lookups, adaptive refresh stream
├── state/    Zustand stores: aircraft, selection, panel, a11y (subscribable from both
│             React UI and the Three.js render loop)
└── ui/       React shell — AppShell, HudCounter, SidePanel, FlightCard, AircraftList,
              BrandWatermark

server/index.ts   Fastify: /api/states + /health + static dist/
public/data/      Bundled static data (Natural Earth, OpenFlights, OurAirports + tz)
railway.toml      Railway build + deploy config
docs/superpowers/ Original spec + implementation plan
```
