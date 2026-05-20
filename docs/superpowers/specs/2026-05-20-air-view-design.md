# Air View v1 — Design Spec

**Status:** approved 2026-05-20
**Owner:** Riccardo Romano
**Brainstorm transcript origin:** session opened 2026-05-20
**Companion docs:** `PRODUCT.md` (product purpose, brand, anti-references, visual language) · `DESIGN.md` (Apple design tokens)

---

## 1. Product summary

Air View is a single-page web experience that renders the planet Earth as a luminous, crystalline, slightly-translucent body, and overlays every aircraft currently in the sky against that body using live ADS-B data. The visitor can pan, zoom, and click any aircraft to read a quiet card with flight information.

The product is a portfolio piece that must read simultaneously as art (a phenomenon worth remembering) and as a working tool (real data, true to the feed). Success is measured by visitors remembering "the Earth made of glass and light" and telling one other person. Success is *not* measured in tracking utility — this is the explicit opposite of Flightradar24.

This v1 ships the **Single Moment + A11y** scope: globe + click → flight card + accessible list view. Search, URL deep-link, and street-level zoom are deferred to v2+.

---

## 2. Scope

### In scope (v1)

- Real-time rendering of every aircraft currently visible in the OpenSky Network feed.
- Globe rendered as frosted glass / ice material, custom GLSL shader.
- Continents, national borders, motorways, and major capitals as hairlines (Natural Earth 1:50m).
- Zoom depth: planet → continent → region. **No city, no street, no 3D buildings in v1.**
- Click an aircraft → side panel opens with flight card.
- Side panel doubles as accessible list view (filterable, scrollable, keyboard-navigable).
- HUD top-left: live aircraft counter ("14,832 aircraft").
- Flight card content: callsign, route IATA (origin → destination), current local time at origin and destination, altitude, ground speed, model, operator.
- WCAG 2.2 AA compliance across all interactive surfaces.
- `prefers-reduced-motion` first-class support.

### Out of scope (deferred to v2+)

- Search by flight number, route, airport, operator.
- URL deep-link to a specific aircraft (shareable links).
- City and street-level zoom with 3D building rendering.
- Scheduled / actual departure & arrival times (requires paid API).
- Historical aircraft trails (> 5 seconds).
- Multi-aircraft selection or comparison.
- Filters (by altitude, by operator, by region).
- Mobile-specific design beyond responsive scaling.

### Anti-scope (will never ship)

Anything that lands on the anti-references in `PRODUCT.md` §Anti-references: Flightradar24-style 2D tracker chrome, Google Earth photorealistic textures, stock three.js blue marble, dashboard SaaS / crypto neon aesthetic, plane sprites with wings, heavy bloom or sci-fi glow.

---

## 3. Constraints inherited

- **`PRODUCT.md` §Visual Language Specifics** is the visual contract. Every implementation decision must respect Vincoli 1–6 verbatim.
- **`DESIGN.md`** provides the token system: SF Pro typography, Action Blue (#0066cc), parchment / pearl / tile palette, 8-px spacing rhythm, button grammar (`{rounded.pill}`, `{rounded.sm}`, `{rounded.lg}`), the single product-shadow rule.
- **Data must be true and live** — never synthetic, never beautified beyond interpolation supported by the feed.
- **Free public web page** — no paid backend services. OpenSky free tier + Vercel free tier + static route databases.

---

## 4. Architecture — Four-layer separation

```
┌─────────────────────────────────────────────────────────┐
│ UI shell (React)            src/ui/                     │
│   <AppShell> <HudCounter> <SidePanel>                   │
│     <FlightCard>  <AircraftList>                        │
├─────────────────────────────────────────────────────────┤
│ State (Zustand)             src/state/                  │
│   aircraftStore  selectionStore  panelStore  a11yStore  │
│   Framework-agnostic; subscribable by both React + Scene│
├─────────────────────────────────────────────────────────┤
│ Data (vanilla TS)           src/data/                   │
│   openSkyClient · routeLookup · airportLookup           │
│   timezones · aircraftStream · adaptive refresh loop    │
├─────────────────────────────────────────────────────────┤
│ Scene (Three.js raw)        src/globe/                  │
│   globeMesh · aircraftPoints · leaderLine · controls    │
│   manual render loop, no R3F abstraction                │
└─────────────────────────────────────────────────────────┘
```

**Critical boundary**: Scene and UI never reference each other directly. They both subscribe to the State layer. This prevents React reconciliation from triggering scene re-renders, and prevents Three.js mutations from forcing React updates.

**Stack**: Vite + React + Three.js raw (no React-Three-Fiber). TypeScript strict mode.

---

## 5. Visual system — DESIGN.md mapped to Air View

Air View is dark-dominant — the inverse of the Apple catalog (light-dominant). Tokens carry over unchanged; the surface mix changes.

### Palette mapping

| Air View element | `DESIGN.md` token | Notes |
|---|---|---|
| Scene background | `{colors.surface-black}` → `{colors.surface-tile-3}` radial fade | Deep space |
| Selected aircraft + leader line | `{colors.primary}` #0066cc | The single accent |
| Inline links in panel | `{colors.primary-on-dark}` #2997ff | "Currently overhead" etc. |
| Side panel base | `{colors.surface-tile-1}` #272729 @ 78% opacity + backdrop-blur(20px) saturate(140%) | Frosted, after `{component.sub-nav-frosted}` |
| Panel text primary | `{colors.body-on-dark}` #ffffff | |
| Panel text secondary | `{colors.body-muted}` #cccccc | Labels, captions |
| Hairlines (sections) | `{colors.hairline}` #e0e0e0 @ 12% opacity on dark | |
| Focus ring | `{colors.primary-focus}` #0071e3, 2px outline | Tab keyboard nav |
| HUD counter text | `{colors.body-on-dark}` @ 70% opacity | Observatory tone |
| Cruising aircraft | `#ffe6c4` warm white | **New token (extension)** — the only warm element |
| Aircraft on ground | `#ffe6c4` @ 60% luminance, no trail | |

### Typography mapping

| Air View element | Token | Example |
|---|---|---|
| HUD counter | `{typography.caption-strong}` | "14,832 aircraft" |
| Panel header | `{typography.tagline}` | "Aircraft" / "BA0274" |
| Flight callsign | `{typography.body-strong}` | "BA0274" |
| Route IATA | `{typography.body}` | "LHR → JFK" |
| Local time origin/dest | `{typography.body}` | "14:32 BST · 09:32 EDT" |
| Card labels | `{typography.caption}` `caps-tracked` | "ALTITUDE" |
| Card values | `{typography.body}` | "38,000 ft" |
| List item callsign | `{typography.body-strong}` | "BA0274" |
| List item subtitle | `{typography.caption}` | "British Airways · LHR → JFK" |
| Card timestamp footer | `{typography.fine-print}` | "Last seen 14:32:08 UTC" |

### Spacing & radius

- Panel padding: `{spacing.lg}` 24px (desktop), `{spacing.md}` 17px (mobile).
- Card-to-viewport edge: `{spacing.xl}` 32px (desktop), `{spacing.md}` 17px (mobile).
- Inter-row gap: `{spacing.md}` 17px.
- Tight gaps inside list rows: `{spacing.xs}` 8px.
- Side panel radius: `{rounded.lg}` 18px.
- Close button: `{rounded.pill}` 44×44 circular.
- List filter pill: `{rounded.pill}`.
- List item rows: `{rounded.sm}` 8px.

---

## 6. Globe material — shader spec

`THREE.ShaderMaterial` with four contributions, no decorative gradients, no PBR.

```
Globe material composition (GLSL fragment, conceptual):

  1. Base translucent fill
       smoothstep(NdotV, 0.0, 1.0) * mix(#1a1d24, #3a4258, 0.5)
       Cool blue-grey neutral. The center of the sphere is denser frosted;
       the limb thins to atmosphere.

  2. Specular drift
       noise(uv * 4.0 + uTime * 0.02) * 0.08
       Applied only where fresnel is high (limb edge).
       Multiplied by 0.0 if prefers-reduced-motion.

  3. Continent line-art (separate pass)
       THREE.LineSegments overlay from Natural Earth 1:50m GeoJSON
       Stroke #ffffff @ 0.35 alpha, additive blend
       Thicker for capitals (1.5x stroke), thinner for admin1 (0.7x)

  4. Atmosphere halo (back-faces of larger sphere behind globe)
       fresnel^4 * #88aaff @ 0.18 alpha
       Cold, thin, never bloom. Wraps the limb only.
```

**Hard rule (from `PRODUCT.md` Vincolo 2 & 6):**
- No metalness, no roughness map, no albedo texture.
- Frosted color always cool (blue-grey range), never warm.
- Specular drift only at the limb. The body of the globe stays calm.

**Continents source**: `natural-earth-vector` ne_50m_admin_0_countries + ne_50m_admin_1_states_provinces + ne_50m_populated_places + ne_50m_roads. Bundle ~600 KB gzipped. Loaded once at startup, projected lat/lon → unit sphere.

---

## 7. Aircraft visual spec

Aircraft are a single `THREE.Points` cloud with custom shader. Vincolo 3 `PRODUCT.md`: the globe is the cathedral, the aircraft are the candles. The luminance gap is codified:

```
Cruising aircraft point:
  size_px       2-4 (size attenuation by distance to camera)
  color         #ffe6c4 warm white (extension token, motivated by Vincolo 3)
  core_lum      1.0 (additive write)
  halo          gaussian falloff to 0.4 over 8-10px
  trail         3-5s, last ~30 positions interpolated, alpha decay quadratic

Selected aircraft point:
  size_px       5-7
  color         {colors.primary} #0066cc Action Blue
  core_lum      1.2 super-bright core, additive
  halo          falloff to 0.3 over 14-16px
  trail         same length, colorized to Action Blue
  leader_line   2D screen-space, dashed Action Blue @ 55% alpha, 1px stroke

Ground aircraft (on_ground flag from OpenSky):
  size_px       2-3
  color         same as cruising
  core_lum      0.6
  trail         none
```

**Trail rendering**: between raw OpenSky updates (15–60s apart) only 1–2 true positions exist per aircraft. The trail is rendered as a fading tail *behind* the aircraft, generated by extrapolating from the last known position backward in time using velocity + heading vectors. Visually this yields a continuous fading wake even though raw positions are sparse. Rendered as `THREE.Line` per aircraft (or batched BufferGeometry for performance), vertex-colored with quadratic alpha decay.

**Tap target a11y**: raycast hit-zone radius is 16px in screen space around each aircraft point. When aircraft density in the rendered viewport falls below 1 per 100×100px region, the hit-zone expands to 44px radius to satisfy WCAG 2.5.5 minimum target size. Raycasting via `THREE.Raycaster` against a parallel cloud of larger invisible quads.

---

## 8. Side panel (flight card + list view)

Single panel, two modes. Frosted-glass grammar inherited from `DESIGN.md` `{component.sub-nav-frosted}`; right-rail layout inspired by the iPhone configurator. Mounted right-side on desktop (≥ 640px), slides up from the bottom edge as a sheet on mobile (< 640px).

### Default state

- Header strip visible always: `{typography.tagline}` "Air View" on left, `<button>` toggle "Aircraft list" on right.
- Panel body hidden until user action.

### Flight card mode

Triggered by click/tap on an aircraft. Panel slides in (250ms ease-out-quart), opaque-tinted base ensures `≥4.5:1` contrast independent of background. Content top to bottom:

```
[ Close ✕ ]                              ← {rounded.pill} 44×44, top-right

BA0274                                   ← callsign, body-strong, large
British Airways                          ← operator, caption, muted

LHR → JFK                                ← route IATA, body
14:32 BST · 09:32 EDT                    ← current local times, body
                                           (live, updates with browser clock)

────────                                 ← hairline divider

ALTITUDE                                 ← label, caption tracked
38,000 ft                                ← value, body

GROUND SPEED
473 kt

MODEL
747-400

ICAO24
406b1e

────────

Last seen 14:32:08 UTC                   ← fine-print, muted
```

### List view mode

Triggered by header toggle button. Same panel, different body:

```
[ Close ✕ ]

Aircraft (14,832)                        ← tagline + count

[ Filter callsign or route... ]          ← {rounded.pill} input, no fuzzy in v1

────────

BA0274          38,000 ft                ← list item, hover/focus highlight
British Airways · LHR → JFK              ← {rounded.sm} row

AA0123          41,000 ft                ← keyboard arrows navigate
American Airlines · JFK → LAX            ← Enter selects → switches to flight card mode

(virtualized: window of ~30 visible
 rows out of N total)
```

### Mobile (<640px)

Panel becomes bottom sheet (slide-up from bottom edge), 70% of viewport height max, swipe-down-to-close gesture. Identical content, identical modes.

### Aircraft selected highlight

While the panel is open in flight card mode, the selected aircraft in the scene is rendered in Action Blue with elevated luminance (see §7). This is the spatial connection between panel and globe — the panel is *informationally* anchored to the aircraft, the colour anchors the relationship *spatially*.

---

## 9. HUD aircraft counter

Top-left corner of the viewport. Observatory tone — almost invisible, never advertising.

```
Layout:
  position    fixed, top: {spacing.xl} 32px, left: {spacing.xl} 32px
  typography  {typography.caption-strong}
  color       {colors.body-on-dark} @ 70% opacity
  format      "14,832 aircraft"    (locale-aware separators)

A11y:
  role         status
  aria-live    polite
  aria-atomic  true
  announces    on count change > 100 to avoid noise
```

No background, no border, no chip — just text floating against the scene.

---

## 10. Data layer

### Sources

| Source | Purpose | Update freq | Auth |
|---|---|---|---|
| OpenSky Network `/states/all` | Live aircraft positions + state | Adaptive: 15s active / 30s idle / 60s background | Basic auth (env var on Vercel) |
| OpenFlights `routes.dat` (static) | Callsign → IATA route lookup | Bundled at build time, ~2 MB gzipped | None |
| OurAirports `airports.csv` (static) | IATA/ICAO → coordinates, timezone | Bundled at build time, ~700 KB gzipped | None |
| IANA tz database (via Luxon) | Local time at airport timezone | Continuous (client clock) | None |

### Adaptive refresh loop

```
state := activeWithinLast30s ? ACTIVE
       : tabHidden            ? BACKGROUND
                              : IDLE

interval := { ACTIVE: 15_000, IDLE: 30_000, BACKGROUND: 60_000 }[state]

every interval ms:
  GET https://air-view.vercel.app/api/states
       (Vercel edge function proxies OpenSky with cached response, ETag-aware)
  on response:
    normalize → Map<icao24, Aircraft>
    merge with previous (preserve trail history, drop aircraft missing > 60s)
    push to aircraftStore
```

### Vercel edge function

```
/api/states
  - Reads OPENSKY_USER, OPENSKY_PASS from env
  - In-memory cache 15s shared across requests
  - Returns normalized JSON: { aircraft: [...], fetchedAt: ISO8601 }
  - Sets Cache-Control: s-maxage=10, stale-while-revalidate=20
  - On OpenSky 5xx/timeout: returns last known + 5xx flag
```

### Callsign → route resolution

```
parseCallsign("BAW274") → { airlineIcao: "BAW", flightNumber: "274" }
lookupAirline("BAW") → { iata: "BA", name: "British Airways" }
lookupRoute("BA", "274") → { originIata: "LHR", destinationIata: "JFK" }
lookupAirport("LHR") → { name: "Heathrow", lat, lon, tz: "Europe/London" }
formatLocalTime(now, "Europe/London") → "14:32 BST"
```

Edge cases:
- Callsign matches no airline pattern (military, charter, ferry) → route = "—", show callsign + altitude + model only.
- Airline matches but flight number not in routes.dat → route = "—", same fallback.
- Airport timezone unknown → show "UTC" with fine-print disclaimer.

---

## 11. State layer (Zustand)

```ts
// aircraftStore
type Aircraft = {
  icao24: string;
  callsign: string;
  lat: number; lon: number; altitude_ft: number;
  velocity_kt: number; heading_deg: number;
  onGround: boolean;
  lastSeen: number;        // unix ms
  trail: Position[];       // last ~30 interpolated positions
  resolved?: ResolvedFlight; // route + tz, lazily resolved
}
type AircraftStore = {
  aircraft: Map<string, Aircraft>;
  fetchedAt: number;
  fetchStatus: 'idle' | 'fetching' | 'error';
  updateBatch(newStates: Aircraft[]): void;
}

// selectionStore
type SelectionStore = {
  selectedIcao: string | null;
  select(icao: string | null): void;
}

// panelStore
type PanelStore = {
  mode: 'closed' | 'flight' | 'list';
  open(mode: 'flight' | 'list'): void;
  close(): void;
}

// a11yStore
type A11yStore = {
  prefersReducedMotion: boolean;  // synced from media query
  keyboardMode: boolean;          // true after first Tab press
}
```

All four stores are subscribable from Scene (vanilla `store.subscribe`) and React (`useStore` hook).

---

## 12. Error handling

| Failure | Behavior | User-visible |
|---|---|---|
| OpenSky 429 / 5xx | Exponential backoff (max 5min), keep last state | Pulse near HUD: *"signal interrupted · retrying"* in `fine-print` |
| OpenSky timeout > 30s | Aircraft older than 60s fade to 30% opacity | Implicit |
| Aircraft missing from feed | Trail preserved 60s, then removed via fade (1s) | Implicit |
| Selected aircraft disappears | Card shows "Last seen at HH:MM:SS UTC · signal lost". Panel auto-closes after 60s. | Explicit but soft |
| WebGL2 unavailable | Fallback static page: observatory text + counter only, no scene | Explicit: *"Air View requires WebGL2."* |
| `prefers-reduced-motion: reduce` | No autorotate, no specular drift, no trail animation (static dots) | Implicit |
| Route lookup miss | Card shows callsign + altitude + model only; route = "—" | Implicit |
| Airport tz unknown | Show "UTC" + fine-print disclaimer | Implicit |

---

## 13. A11y compliance (WCAG 2.2 AA)

| Criterion | Implementation |
|---|---|
| 1.4.3 Contrast Minimum | Panel text 17px white on #272729 @ 78% + blur ≈ 12:1 ratio. HUD text @ 70% opacity verified ≥ 4.5:1. |
| 2.1.1 Keyboard | Tab focuses panel toggle. List mode: arrows + Enter + Esc. Flight card: Esc closes. |
| 2.4.7 Focus Visible | 2px `{colors.primary-focus}` outline on every focusable element. |
| 2.3.3 Animation from Interactions | `prefers-reduced-motion`: no autorotate, no specular drift, no trail anim, no panel slide. |
| 1.3.1 Info and Relationships | Flight card is `<article>` with `<dl>` data. Route as `<address>`. |
| 4.1.3 Status Messages | HUD counter updates via `aria-live="polite"`, throttled (announce only on Δ > 100). |
| 2.5.5 Target Size | All buttons + list items ≥ 44×44px. Aircraft tap-zone padded to ≥ 16px screen-space. |
| Color independence | Selected aircraft = blue AND larger AND in panel header. Never color-only. |
| Bypass mechanism | Skip-link "Skip to aircraft list" at page top, visible on focus. |

---

## 14. Testing strategy

- **Data layer**: Vitest unit tests. OpenSky response → Aircraft normalization. Callsign parsing edge cases (military, charter, ferry, BAW vs BA prefixes). Route lookup misses.
- **State layer**: Vitest unit tests. Store transitions: idle → flight → list → close. Selection lifecycle including disappearing aircraft.
- **Scene layer**: not unit-tested (WebGL). Visual regression via Playwright screenshot snapshots against a deterministic mocked aircraft store. Snapshots committed.
- **UI layer**: React Testing Library component tests. `<FlightCard>` rendering by aircraft shape. `<AircraftList>` keyboard navigation. `<HudCounter>` formatting + aria-live announce threshold.
- **E2E happy path**: Playwright. Open page → wait globe loaded → wait first aircraft batch → click random aircraft → assert panel opens with matching callsign → toggle to list mode → arrow-down → Enter → assert different aircraft selected.
- **A11y automation**: axe-core in E2E. Target 0 violations in default flow, with `prefers-reduced-motion`, and in keyboard-only flow.

---

## 15. Deployment

- **Host**: Vercel free tier.
- **Frontend**: Vite SPA build, static hosted, edge-CDN distributed.
- **Backend**: single Vercel edge function `/api/states`. Env vars: `OPENSKY_USER`, `OPENSKY_PASS`.
- **Domain**: chosen at launch. Development placeholder: `air-view.vercel.app` (auto-assigned by Vercel).
- **Analytics**: none in v1 (observatory tone — no GA / tracking).
- **Monitoring**: Vercel built-in function metrics. OpenSky 5xx surfaced via Vercel logs.

---

## 16. Open questions & deferred to v2+

These were raised during brainstorm and explicitly deferred:

1. **Search by callsign / route / airport / operator** — list view filter input in v1 covers basic discovery without dedicated search UI.
2. **URL deep-link to selected aircraft** (`/flight/BA0274`) — requires routing layer, not in Single Moment scope.
3. **City and street-level zoom** — `PRODUCT.md` §Visual Language §1 describes the full zoom ladder. v1 stops at Region; v2+ adds City + Street with curated landmarks.
4. **Scheduled departure / arrival times** — would require paid API (FlightAware AeroAPI ≈ 50–80 USD/month). Deferred unless monetization strategy emerges.
5. **Multi-aircraft selection / comparison** — interesting but inconsistent with "one moment of contact" principle.
6. **Filters** (altitude, region, operator) — list view in v2 may add filter chips.
7. **Aircraft historical replay** — interesting art piece (a time slider scrubbing through past 24h), explicit v3+.
8. **Landmark dataset** — when v2 introduces city-level zoom, need a curated landmark dataset (Colosseum, Eiffel Tower, etc.). Likely a community-curated JSON.

---

*End of spec. Implementation plan to follow via `superpowers:writing-plans`.*
