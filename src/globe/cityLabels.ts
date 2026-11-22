import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { CityPlace } from '@/data/cityPlaces';
import { GLOBE_RADIUS, isOnNearSide, visibleCapRadiusNm } from './geoHelpers';

/**
 * Which places are eligible at this view radius.
 *
 * SCALERANK is Natural Earth's own statement of the map scale at which a
 * place deserves to appear — the user's "il nome della città non esce
 * quando sono troppo fuori, però man mano mi avvicino esce", already
 * answered by cartographers. Inventing a population threshold would be
 * redoing that work worse.
 *
 * The thresholds are the worst-case counts measured by centring the camera
 * on each of the 1 251 places in turn (plan §2.4), not an intuition:
 *
 *   cap > 1 400 NM   nothing        (70 px of label is 227 NM: the dot is 1 px)
 *   700 … 1 400      SCALERANK ≤ 1  worst 15 candidates
 *   350 … 700        SCALERANK ≤ 2  worst 31
 *   140 … 350        SCALERANK ≤ 4  worst 26
 *   ≤ 140            all            worst 11
 *
 * Returns null for "no labels at all", which is not the same as 0 — 0 is
 * the 27 world cities of SCALERANK 0.
 */
export function scalerankCeilingFor(capNm: number): number | null {
  if (capNm > 1400) return null;
  if (capNm > 700) return 1;
  if (capNm > 350) return 2;
  if (capNm > 140) return 4;
  return 10;
}

/**
 * The box a label occupies, measured on .marker__label's own metrics:
 * 11 px, 600 weight, 0,06em tracking, and a name of a dozen characters.
 *
 * Measured rather than computed per label: measuring text costs a reflow,
 * and sixty reflows a second for 24 names would be a worse price than the
 * occasional name that is a little wider than its box.
 */
export const LABEL_BOX_W = 70;
export const LABEL_BOX_H = 16;
/** Breathing room, so two accepted names never read as one. */
export const LABEL_BOX_MARGIN = 4;
/**
 * The ceiling, and it is not what the browser can take.
 *
 * A browser would take a thousand DOM nodes without noticing. 24 is where a
 * MAP stops being readable — and it bounds the greedy pass at 276
 * intersection tests a frame (D43).
 */
export const MAX_CITY_LABELS = 24;

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CityLabel {
  place: CityPlace;
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

function intersects(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + LABEL_BOX_MARGIN * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + LABEL_BOX_MARGIN * 2
  );
}

/**
 * Which of these candidates get a name, in the order they are given.
 *
 * Greedy over an array that is ALREADY in priority order — cities.json is
 * sorted by (SCALERANK, LABELRANK, -POP_MAX) at build time — so "first
 * accepted wins the pixel" IS "the more important name wins the pixel", and
 * the result is deterministic, which is the only kind a test can fix (D43).
 *
 * `taken` comes in with absolute priority and is never evicted: those are
 * the D/A markers, i.e. the route the user ASKED for, and a city may not
 * cover it.
 *
 * No transcendental call anywhere: two comparisons per box pair, at most
 * 276 pairs.
 */
export function selectCityLabels(
  candidates: CityPlace[],
  project: (index: number) => ScreenPoint,
  taken: LabelBox[],
  maxLabels: number
): CityLabel[] {
  const accepted: LabelBox[] = [...taken];
  const out: CityLabel[] = [];
  for (let i = 0; i < candidates.length && out.length < maxLabels; i++) {
    const at = project(i);
    if (!at.visible) continue;
    const box: LabelBox = { x: at.x, y: at.y, w: LABEL_BOX_W, h: LABEL_BOX_H };
    let clear = true;
    for (const other of accepted) {
      if (intersects(box, other)) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    accepted.push(box);
    out.push({ place: candidates[i]!, x: at.x, y: at.y });
  }
  return out;
}

export interface CityLabels {
  /**
   * @param taken the boxes the D/A markers already hold this frame. They
   *   win every collision (D43).
   */
  update: (
    places: CityPlace[],
    camera: Camera,
    width: number,
    height: number,
    fovDeg: number,
    taken: LabelBox[]
  ) => void;
  dispose: () => void;
}

/**
 * City names as DOM over the canvas, the way airportMarkers.ts does it.
 *
 * DOM and not a Points layer for the same reason: a name is text, and text
 * in a shader means shipping a glyph atlas. Reprojected every frame with no
 * anchor and no cache, so zoom, rotation, damping and resize are all correct
 * without one listener.
 *
 * aria-hidden and pointer-events: none. These are not commands, they are not
 * clickable, and announcing 24 of them into a live region that already
 * speaks about the feed would be noise over the thing that matters (D43).
 */
export function createCityLabels(container: HTMLElement): CityLabels {
  const nodes: HTMLElement[] = [];
  const scratch = new Vector3();

  function nodeAt(i: number): HTMLElement {
    const existing = nodes[i];
    if (existing) return existing;
    const el = document.createElement('div');
    el.className = 'city';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="city__dot"></span><span class="city__name"></span>';
    container.appendChild(el);
    nodes[i] = el;
    return el;
  }

  function update(
    places: CityPlace[],
    camera: Camera,
    width: number,
    height: number,
    fovDeg: number,
    taken: LabelBox[]
  ): void {
    const distance = camera.position.length();
    const capNm = visibleCapRadiusNm(distance, fovDeg);
    const ceiling = scalerankCeilingFor(capNm);
    if (ceiling === null) {
      for (const el of nodes) el.style.display = 'none';
      return;
    }

    // The scale is a PREFIX of the array, so this is where the walk stops —
    // not a filter over all 1 251 (D43).
    let end = 0;
    while (end < places.length && places[end]!.scalerank <= ceiling) end++;
    const candidates = places.slice(0, end);

    const chosen = selectCityLabels(
      candidates,
      (i) => {
        const place = candidates[i]!;
        // The precomputed direction, scaled to the surface: no sin, no cos,
        // no lat/lon round trip (D43).
        scratch.copy(place.dir).multiplyScalar(GLOBE_RADIUS);
        if (!isOnNearSide(camera.position, scratch)) return { x: 0, y: 0, visible: false };
        scratch.project(camera);
        return {
          x: ((scratch.x + 1) * width) / 2,
          y: ((1 - scratch.y) * height) / 2,
          visible: true,
        };
      },
      taken,
      MAX_CITY_LABELS
    );

    for (let i = 0; i < Math.max(nodes.length, chosen.length); i++) {
      const label = chosen[i];
      if (label === undefined) {
        const el = nodes[i];
        if (el) el.style.display = 'none';
        continue;
      }
      const el = nodeAt(i);
      el.style.display = '';
      const name = el.querySelector<HTMLElement>('.city__name');
      if (name) name.textContent = label.place.name;
      el.style.transform = `translate3d(${label.x.toFixed(1)}px, ${label.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  return {
    update,
    dispose: () => {
      for (const el of nodes) el.remove();
      nodes.length = 0;
    },
  };
}
