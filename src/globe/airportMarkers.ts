import type { Camera } from 'three';
import { Vector3 } from 'three';
import { CAMERA_FAR_LIMIT, CAMERA_NEAR_LIMIT, isOnNearSide, latLonToVec3 } from './geoHelpers';
import type { RouteEnd } from '@/data/airportInfo';

/**
 * 'D/A' is one marker for both ends, used when the two ends are one point:
 * 13 of the 4 243 routes in the committed cache depart and arrive at the
 * same airport, and two dots on the same pixel put A over D and make the
 * departure unreachable with a mouse.
 */
export type MarkerLetter = 'D' | 'A' | 'D/A';

export interface MarkerSpec {
  end: RouteEnd;
  letter: MarkerLetter;
  iata: string;
  lat: number;
  lon: number;
}

export interface MarkerPlacement {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Below this camera distance the IATA code appears beside the dot.
 *
 * The travel is CAMERA_NEAR_LIMIT..CAMERA_FAR_LIMIT world units — 1,55 to
 * 10,0 — and this is its geometric midpoint, sqrt(1,55 × 10) = 3,937,
 * where it was 4,359 while the travel ended at 1,9 (D35). It recomputes
 * itself, which is exactly what Plan 2 wrote it as a geometric mean for.
 * It keeps the label on the
 * closer half of a travel that is now logarithmic rather than linear. The
 * old value of 6,0 was described as "the lower half of 3,0 to 10,0 globe
 * radii", and the travel was neither in radii nor from 3,0.
 */
export const MARKER_LABEL_MAX_DISTANCE = Math.sqrt(CAMERA_NEAR_LIMIT * CAMERA_FAR_LIMIT);

export function markerLabelVisible(cameraDistance: number): boolean {
  return cameraDistance <= MARKER_LABEL_MAX_DISTANCE;
}

/**
 * Where an airport is on screen, this frame.
 *
 * Nothing is anchored and nothing is cached: the geographic position is
 * projected afresh every frame, which is why zoom, rotation, damping and
 * window resizes are all correct without a single listener. leaderLine.ts
 * has done exactly this since v1.
 */
export function projectMarker(
  point: { lat: number; lon: number },
  camera: Camera,
  width: number,
  height: number
): MarkerPlacement {
  const world = latLonToVec3(point.lat, point.lon);
  if (!isOnNearSide(camera.position, world)) {
    return { x: 0, y: 0, visible: false };
  }
  const p = new Vector3().copy(world).project(camera);
  return {
    x: ((p.x + 1) * width) / 2,
    y: ((1 - p.y) * height) / 2,
    visible: true,
  };
}

export interface AirportMarkers {
  update: (specs: MarkerSpec[], camera: Camera, width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Keyed by the LETTER, not by the end: the letter is what the user sees on
 * the dot, so the accessible name and the dot cannot come to disagree — and
 * a single marker standing for both ends has to say both.
 */
const LETTER_WORD: Record<MarkerLetter, string> = {
  D: 'Departure',
  A: 'Arrival',
  'D/A': 'Departure and arrival',
};

/**
 * Two DOM buttons over the canvas, moved by the render loop.
 *
 * DOM rather than a Points layer because a marker has to be clickable,
 * reachable with a keyboard — axe runs over this page — and has to carry
 * text, which in a shader would mean shipping a glyph atlas.
 */
export function createAirportMarkers(
  container: HTMLElement,
  onPick: (end: RouteEnd) => void
): AirportMarkers {
  const nodes = new Map<RouteEnd, HTMLButtonElement>();

  function nodeFor(spec: MarkerSpec): HTMLButtonElement {
    const existing = nodes.get(spec.end);
    if (existing) return existing;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'marker';
    btn.dataset.end = spec.end;
    btn.innerHTML =
      '<span class="marker__dot" aria-hidden="true"></span>' +
      '<span class="marker__label"></span>';
    btn.addEventListener('click', (e) => {
      // The canvas click handler selects and deselects aircraft; a click
      // that lands on a marker is about the marker.
      e.stopPropagation();
      onPick(spec.end);
    });
    container.appendChild(btn);
    nodes.set(spec.end, btn);
    return btn;
  }

  function update(specs: MarkerSpec[], camera: Camera, width: number, height: number): void {
    const wanted = new Set(specs.map((s) => s.end));
    for (const [end, node] of nodes) {
      if (!wanted.has(end)) {
        node.remove();
        nodes.delete(end);
      }
    }
    const showLabel = markerLabelVisible(camera.position.length());
    for (const spec of specs) {
      const node = nodeFor(spec);
      // Identity before placement. A marker on the far hemisphere is
      // hidden, not anonymous: writing the letter and the code only on the
      // visible branch left the A of a destination behind the globe blank
      // until the planet happened to turn, so what the marker IS would have
      // depended on where the camera was standing.
      node.setAttribute('aria-label', `${LETTER_WORD[spec.letter]} ${spec.iata}`);
      const dot = node.querySelector('.marker__dot');
      if (dot) dot.textContent = spec.letter;
      const label = node.querySelector<HTMLElement>('.marker__label');
      if (label) {
        label.textContent = spec.iata;
        label.style.display = showLabel ? '' : 'none';
      }
      const at = projectMarker(spec, camera, width, height);
      if (!at.visible) {
        node.style.display = 'none';
        continue;
      }
      node.style.display = '';
      node.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  return {
    update,
    dispose: () => {
      for (const node of nodes.values()) node.remove();
      nodes.clear();
    },
  };
}
