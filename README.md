# Air View

Single-page web experience rendering Earth as frosted glass and every aircraft
currently in the sky as a luminous point.

## Setup

```bash
npm install
node scripts/build-static-data.mjs   # one-time: downloads Natural Earth, OpenFlights, OurAirports
cp .env.example .env                 # add your OpenSky credentials
npm run dev
```

Open `http://localhost:5173`.

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

Push to a Vercel-connected repo. Set `OPENSKY_USER` and `OPENSKY_PASS` as
Vercel project env vars.

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
