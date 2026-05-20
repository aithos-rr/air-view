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

### OpenSky OAuth2 credentials

OpenSky deprecated basic auth in mid-March 2025; new accounts must use
OAuth2 client_credentials. To get a clientId/clientSecret:

1. Sign in at <https://opensky-network.org>
2. Account → **API Clients** → *Create new client*
3. Download `credentials.json` (or copy the values shown on screen)
4. Paste `clientId` and `clientSecret` into `.env`:

```
OPENSKY_CLIENT_ID=<your-client-id>
OPENSKY_CLIENT_SECRET=<your-client-secret>
```

The edge function (`api/states.ts`) handles the token exchange and refresh
automatically — the credentials never touch the browser.

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

The backend is a Node.js Fastify server (`server/index.ts`), deployable as a
single Railway service. The Vite frontend is built to static assets and
served alongside the API (or as a separate Railway service if you prefer).

```bash
railway login
railway link                                                # link to your project
railway variables set OPENSKY_CLIENT_ID=<your-client-id>
railway variables set OPENSKY_CLIENT_SECRET=<your-client-secret>
railway up                                                  # build + deploy
```

Railway injects `PORT` automatically; the server binds to `0.0.0.0:$PORT`.
Health check is exposed at `GET /health`. Configuration (build / start /
healthcheck) lives in `railway.toml` at the project root.

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
