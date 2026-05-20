# Air View

Single-page web experience rendering Earth as frosted glass and every aircraft
currently in the sky as a luminous point.

## Setup

```bash
npm install
node scripts/build-static-data.mjs   # one-time: downloads Natural Earth, OpenFlights, OurAirports
cp .env.example .env                 # add your OpenSky OAuth2 credentials (see below)
npm run dev
```

Open `http://localhost:5173`.

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

## Deploy

Push to a Vercel-connected repo. Set `OPENSKY_CLIENT_ID` and
`OPENSKY_CLIENT_SECRET` as Vercel project env vars (same values you put in
`.env` locally).

## Project layout

```
src/
├── globe/    Three.js scene (frosted glass shader, aircraft SDF, leader line, raycaster)
├── data/     IO + business (OpenSky client, route/airport lookups, adaptive refresh)
├── state/    Zustand stores (aircraft, selection, panel, a11y) — framework-agnostic
└── ui/       React shell (HUD, side panel, flight card, list view)

api/states.ts  Vercel edge function proxying OpenSky with 15-second cache
public/data/   Bundled static data (Natural Earth, OpenFlights routes, OurAirports)
```
