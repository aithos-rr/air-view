# Product

## Register

brand

## Users

Audience: **tech-and-design literates** — frontend engineers, creative developers, design leads, WebGL/graphics nerds, hiring managers scanning portfolios, design-twitter onlookers, R&D folks at studios and agencies.

Context of arrival: a shared link, a tweet/post embed, a hiring-signal landing from a CV/portfolio. They open the tab on a desktop browser (primary) or a recent phone (secondary). They expect to spend 5–30 seconds deciding whether to keep watching. They are visually trained: they will notice kerning, frame timing, animation easing, contrast errors, and "Tailwind defaults" within the first second.

Their job-to-be-done is not "track a flight." It is "feel something rare on the open web, and judge whether the maker has taste and craft." The site is a portfolio piece masquerading as a tool — and it must hold both readings at once.

## Product Purpose

Air View is a free, single-page web experience that renders the planet Earth in real time as a luminous, crystalline, slightly-translucent body, and overlays every aircraft currently in the sky against that body, sourced from live ADS-B feeds. The visitor can pan, zoom, and click any aircraft to see the flight behind it (origin, destination, altitude, model, operator, ICAO/IATA codes).

Success is not measured in flight-tracking utility. Success is when a visitor, after closing the tab, remembers the planet — "the Earth made of glass and light" — and tells one other person, or saves it as a reference. The site exists to prove that a free, public web page can still produce a *moment*, not a session.

The data must be **true and live** (ADS-B / OpenSky-tier feeds, never synthetic), because the artifact loses its power the second a viewer suspects the planes are fake. The truth of the data is what makes the beauty of the form earned, not decorative.

## Brand Personality

Three words: **reverent · crystalline · precise.**

- **Reverent.** The site speaks in a low voice. No exclamation marks, no marketing copy, no "Welcome to..." or "Discover...". Headings are nouns. Sub-copy is fact, not pitch. The visualization is treated like a phenomenon, not a feature.
- **Crystalline.** The visual language is glass, ice, and faint light against deep space — not photographic Earth, not "sci-fi neon." Material thinking comes first: edges refract, surfaces gather faint specular, the atmosphere is a thin halo, not a glow effect. Every UI surface borrows from this same material logic (frosted strips, fine hairlines, near-invisible chrome).
- **Precise.** Numbers are honest and visible (timestamp, flight count, refresh rate). Type is tight, body at 17px, negative tracking on display — the Apple grammar carried by DESIGN.md. No rounded-corner whimsy, no playful illustration, no decorative gradients. Craft is the marketing.

Voice in copy: an observatory log, not a product page. "Currently tracking 14,832 aircraft" beats "Track flights live!"

## Anti-references

This site must explicitly NOT look or behave like any of the following:

- **Flightradar24 / FlightAware.** No flat 2D Mercator map, no orange/yellow plane sprites, no filters panel, no advertising, no saturated palettes, no "tracker UI" chrome. Their utility is theirs; we are the opposite of their utility.
- **Google Earth.** No photorealistic Maxar/Landsat textures, no HD cloud overlays, no "control-room" panel layout. The planet here is *reinterpreted*, not photographed. We trade satellite truth for material truth.
- **WebGL-globe.org / NASA Eyes / "stock three.js globe" demos.** No default blue-marble texture, no stock atmosphere shader, no boilerplate orbital controls feel. The globe must read as bespoke material study, not as someone's first three.js commit.
- **Dashboard SaaS / Crypto tracker aesthetic.** No purple/green neon, no neon glow on everything, no slate-900 + gradient violet, no techno-monospace numbers, no "linear bro" copy. When glow appears, it is cold, vitreous, and parsimonious.

If a decision could plausibly belong on any of the four references above, it is the wrong decision.

**Additional explicit prohibitions** — the following are forbidden at any zoom level, with no exceptions:

- **Photorealistic Earth textures, satellite imagery in green / brown / blue.** Even zoomed to street level, buildings and roads are NEVER photographic textures.
- **Plane sprites with visible wings, fuselages, or aircraft glyphs.** Aircraft are points of light, never icons of planes.
- **Heavy atmospheric bloom or sci-fi neon glow.** Glow exists but is cold, vitreous, parsimonious. No "halo turned up to 11".
- **Different visual language at different zoom levels.** The glass / hairlines / luminous-points grammar is uniform from full-planet view down to street view. There is no level at which we "switch to Google Maps".

## Design Principles

1. **The globe is the product. Chrome recedes.** Apply DESIGN.md's photography-first logic to a 3D scene: the planet is the hero, every other surface (search input, info card, controls, footer) must justify its visual weight against the globe's gravity. If a piece of UI can be smaller, lighter, or absent, it must be.

2. **Honor the data; reinterpret the planet.** ADS-B feeds and aircraft positions are *real and live* — never simulated, never beautified, never interpolated past what the feed supports. The Earth itself, however, is a designed material: glass, faint atmosphere, line-art continents, slow specular drift. Truth in numbers; poetry in form.

3. **Silence is the tone.** Copy never sells. No CTAs ("Track now!"), no value-prop bullets, no growth-loop language. The site behaves like an observatory feed: nouns, counts, timestamps. The visitor brings the wonder; the site supplies the substrate.

4. **Craft is the only marketing.** The audience is tech-and-design literate. Generic Inter at 16px, Tailwind defaults, soft purple gradients, pop-modals, decorative loading spinners — all immediately disqualify the work. Every visible element must read as deliberate: SF Pro Display tracking, the single Action Blue, the one product-shadow, motion timing in the 200–400ms editorial range, geometry-correct great-circle paths.

5. **One moment of contact.** Clicking an aircraft is the entire interaction grammar. It must feel like *emergence*, not a modal opening: the info appears as if it were always there, anchored to the plane, presented in a quiet card with hierarchy (flight number, route, altitude, model, operator). No tabs, no settings, no "More" link. One click, one answer, then back to the planet.

## Visual Language Specifics

This section codifies the visual constraints sketched above in concrete, non-interpretive form. When in doubt, the rules here override any softer language elsewhere in this document. Earlier mock-ups failed because Brand Personality and Design Principles left too much room for interpretation — this section closes that room.

### 1. Navigation grammar — Google Earth gestures, subject reinterpreted

Movement and zoom behave exactly like Google Earth: drag-pan the globe, scroll / pinch zoom continuously from the whole planet down to the detail of a single street. Real geography is preserved and legible at every level. The aesthetic does not change with zoom — only the density of geographic information does.

| Zoom level | Visible geographic detail |
|---|---|
| **Planet** (min zoom) | Continents and oceans in thin line-art. Europe, Asia, the Americas are recognisable. |
| **Continent** | National borders appear as hairlines. Major capitals (Rome, Milan, Paris, Berlin, …) as labelled luminous points. |
| **Region** | Provincial / regional borders appear. Motorways and major roads emerge as hairlines. |
| **City** | The street network is visible in detail. Significant buildings are drawn as stylised glass volumes. |
| **Street** | Individual buildings are legible — always in the glass / ice language, never as photographic textures. |

Geography is **cartographically true**: real borders, real city coordinates, real road networks, real building footprints, all geolocated correctly. The rendering, however, is *always* in the same glass / hairlines / luminous-points language. The user never falls into a "now we switch to Google Maps textures" mode.

### 2. Globe material — Apple-grade glass / ice

The globe, at every zoom level, is rendered in a translucent frosted glass / ice material. Slightly semi-transparent, with subtle refraction at the limb and faint specular highlights drifting very slowly across the surface. Sphere depth is intuitable but not literal.

What the globe is **not**:
- Not the brown / green / blue of Google Earth.
- Not the uniform blue of a stock three.js globe demo.
- Not an abstract wireframe with no surface presence.

What the globe **is**:
- A *material*, as if Apple had designed the planet as a hand-blown industrial-design object.
- Frosted glass density at the body; hairlines suggesting continents, borders, roads, building footprints — all drawn in continuity with that same language.
- A thin, cold atmospheric halo at the limb. Never a heavy bloom.

### 3. Aircraft as luminous hero element

Aircraft are the detail the eye finds first. They are *significantly brighter than the globe itself*. The globe is calm and cool; the aircraft are warm, defined, dominant points of light.

- Each aircraft is a **luminous point**, never a winged sprite. No Flightradar24-style plane icons. Ever.
- A movement trail, max 3–5 seconds long, fades softly behind moving aircraft. Stationary aircraft (on the ground) have no trail.
- The luminance gap between globe and aircraft is **deliberate and dramatic**: the globe is veiled penumbra, the aircraft are *flames*. Not saturated — warm white / pale gold for cruising traffic; Action Blue (`{colors.primary}`) for the currently selected aircraft.
- The relationship is preserved across zoom: even at city level, aircraft in the visible airspace remain dominant against the streets and buildings underneath. The geography never out-shouts them.

The metaphor: **the globe is the cathedral, the aircraft are the candles.**

### 4. Updated anti-references

See the *Additional explicit prohibitions* in the Anti-references section above. The new prohibitions cover (a) photorealistic textures at any zoom, (b) winged plane sprites, (c) sci-fi atmospheric bloom, (d) any change of visual language across zoom levels.

### 5. Demo precision, not pixel-perfect modelling

"Precise but in demo form" means:

- Real geography — real borders, geolocated cities, real road networks, real building footprints.
- Stylised rendering — always glass / frosted / hairlines.
- We do not model every building on Earth by hand. Procedurally extruded building footprints in the glass material are correct and expected.
- **But landmarks must be distinguishable.** The Colosseum, the Eiffel Tower, the Empire State must read as themselves, not as identical extruded boxes. Treat landmark modelling as a curated set on top of the procedural infill.
- Mock-up failure mode to avoid: a city of uniform square palazzi.
- Mock-up success mode: a city where the eye picks out the landmarks while the rest is honest, consistent procedural infill.

### 6. Dispute resolution — how to decide when in doubt

When designing or implementing and one of these questions arises, the answer is already fixed:

- "Should the globe look more realistic?" → **No.**
- "Should the aircraft be more discreet, less bright?" → **No.**
- "Should streets be photo-textured like Google Maps?" → **No. Always glass / hairlines.**
- "Should we switch to a different material at deep zoom?" → **No. The language is uniform from planet down to street.**
- "Should the atmosphere glow more for impact?" → **No. The halo is cold and thin.**

The deliberate contrast — calm globe of light versus brighter aircraft of light — is the point of the work. It must be preserved at every level of detail and at every zoom.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA across all interactive surfaces, plus serious `prefers-reduced-motion` support.**

- **Contrast 4.5:1** minimum for all body and label text against any surface the globe may parallax behind. The info card uses an opaque-enough backdrop (frosted with `backdrop-filter: blur` + opaque-tinted base) so contrast does not depend on what is behind it at a given frame.
- **Keyboard navigation.** All controls (search input, info card open/close, layer toggles if any) are reachable via Tab with visible focus rings (use DESIGN.md's `primary-focus` 2px outline). Aircraft on the globe are reachable via a "list view" affordance for keyboard users — clicking on a 3D point with a keyboard is not feasible, so we provide a parallel selectable list.
- **`prefers-reduced-motion: reduce`** disables autorotation of the globe, freezes the atmospheric specular drift, removes camera ease/inertia on zoom, and turns plane-trail draws static (current position only, no animated tail).
- **Screen readers.** Info card data is structured as a `<dl>` with semantic labels; flight ID is a `<heading>`; route is an `<address>`-shaped origin → destination read.
- **Color independence.** Aircraft state (climbing / descending / cruising) is never conveyed by color alone — paired with iconographic cue or position-on-axis cue.
- **Touch targets ≥ 44×44px** for the info card close button, search input, and any controls.
- **No autoplaying audio.** Ever.

The globe itself is an experiential surface — visually rich and not strictly "operable" as a control. We do not pretend to make a 3D planet AA-compliant as a widget; we ensure that **every piece of information conveyed visually on the globe is also available through accessible structured controls** (list view, info card semantics, search).
