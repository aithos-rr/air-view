# Air View

Single-page web experience rendering Earth as frosted glass and every aircraft
currently in the sky as a luminous point.

## Setup

```bash
npm install
node scripts/build-static-data.mjs   # one-time: downloads Natural Earth, OpenFlights, OurAirports
cp .env.example .env                 # add your OpenSky OAuth2 credentials (see below)
npm run dev:full                     # starts both Fastify server (:3000) and Vite (:5173)
```

Open `http://localhost:5173`. Vite proxies `/api/*` to the Fastify server.

If you want to run them in separate terminals:

```bash
npm run server   # Fastify on :3000 (Node + tsx watch)
npm run dev      # Vite on :5173
```

### ADS-B data source

Air View pulls live aircraft positions from **adsb.lol**, a community
ADS-B aggregator. No API key, no OAuth, no IP-range blocks — the
endpoint `https://api.adsb.lol/v2/all` is hit by the Fastify server,
cached for 15 s, and proxied to the browser at `/api/states`.

OpenSky was the original choice but their firewall blocks cloud-provider
egress (Railway included), making it unusable from a hosted backend.
The hooks for camera-driven filtering (`bbox` query params, server-side
cache keyed per bbox) survive the switch and will plug into adsb.lol's
`/v2/lat/<lat>/lon/<lon>/dist/<nm>` endpoint in v2.

## Geographic filter

**v1: global fetch, ~14 000 aircraft.** The renderer uses pre-allocated
buffer pools (single `LineSegments` for trails, single `Points` for
aircraft, all sized for 18 000 slots) so the full global feed runs at
40–55 fps. Adaptive refresh is intentionally slow — 30 s active / 60 s
idle / 120 s background — so a 2 MB JSON payload doesn't hammer the
browser parser nor exhaust OpenSky's daily credit budget.

**v2: camera-driven bbox.** The plan is to derive a bounding box from
the camera viewpoint with a buffer ring around it, fetching only the
visible region for sub-second freshness. The plumbing is already in
place: pass `getBoundingBox: () => { lamin, lomin, lamax, lomax }` to
`startAircraftStream`, or hit the API directly with
`GET /api/states?lamin=…&lomin=…&lamax=…&lomax=…`. The server caches
per bbox key, so concurrent regions don't trample each other.

## Tech

Vite + React + TypeScript + Three.js (raw, no R3F) + Zustand + Luxon + Vercel edge.

See `docs/superpowers/specs/2026-05-20-air-view-design.md` for the full design
spec and `docs/superpowers/plans/2026-05-20-air-view-v1.md` for the
implementation plan.

## Test

```bash
npm test          # Vitest unit + component
npm run test:e2e  # Playwright + axe-core (requires: npx playwright install chromium)
```

## Deploy (Railway)

The backend is a Node.js Fastify server (`server/index.ts`) that serves
both `/api/states` (proxying adsb.lol) and the Vite build from `dist/`
as static files. Single Railway service handles everything.

```bash
railway login
railway link                                # link to your project
railway up                                  # build + deploy
```

No API credentials needed — adsb.lol is public.

Railway injects `PORT` automatically; the server binds to `0.0.0.0:$PORT`.
Health check is exposed at `GET /health`. Build/start/healthcheck config
lives in `railway.toml` at the project root. Node 20+ is pinned via
`package.json#engines` and `.nvmrc`.

If you serve the frontend from a different origin, set `FRONTEND_ORIGIN`
on the API service so CORS accepts it. Railway public domains
(`*.railway.app`, `*.up.railway.app`) are allowed by default.

## Project layout

```
src/
├── globe/    Three.js scene (frosted glass shader, aircraft SDF, leader line, raycaster)
├── data/     IO + business (OpenSky client, route/airport lookups, adaptive refresh, openSkyAuth)
├── state/    Zustand stores (aircraft, selection, panel, a11y) — framework-agnostic
└── ui/       React shell (HUD, side panel, flight card, list view)

server/        Fastify Node.js server (deployed on Railway)
  index.ts     /api/states proxy with OAuth2 + 15-second cache, /health
public/data/   Bundled static data (Natural Earth, OpenFlights routes, OurAirports)
railway.toml   Railway build + deploy config
```
