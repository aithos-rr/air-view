import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import {
  MARKER_LABEL_MAX_DISTANCE,
  markerLabelVisible,
  projectMarker,
  createAirportMarkers,
} from '@/globe/airportMarkers';
import type { MarkerSpec } from '@/globe/airportMarkers';

function camera(distance = 4.6): PerspectiveCamera {
  const c = new PerspectiveCamera(38, 800 / 600, 0.1, 100);
  c.position.set(0, 0, distance);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const SPECS: MarkerSpec[] = [
  { end: 'origin', letter: 'D', iata: 'JFK', lat: 0, lon: 0 },
  { end: 'destination', letter: 'A', iata: 'LHR', lat: 0, lon: 180 },
];

/** Both ends on the near hemisphere, so placement is about the camera alone. */
const NEAR_PAIR: MarkerSpec[] = [
  { end: 'origin', letter: 'D', iata: 'JFK', lat: 0, lon: 0 },
  { end: 'destination', letter: 'A', iata: 'LHR', lat: 0, lon: 30 },
];

describe('airport markers', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('puts the label threshold inside the zoom range the controls allow', () => {
    // OrbitControls in scene.ts hold the camera between 3,0 and 10,0 globe
    // radii. A threshold outside that is a constant that can never fire.
    expect(MARKER_LABEL_MAX_DISTANCE).toBeGreaterThan(3.0);
    expect(MARKER_LABEL_MAX_DISTANCE).toBeLessThan(10.0);
  });

  it('shows the IATA label only once the camera is close enough', () => {
    expect(markerLabelVisible(3.2)).toBe(true);
    expect(markerLabelVisible(9.8)).toBe(false);
  });

  it('projects a point under the camera to the centre of the screen', () => {
    const p = projectMarker({ lat: 0, lon: 0 }, camera(), 800, 600);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(400, 0);
    expect(p.y).toBeCloseTo(300, 0);
  });

  it('hides a point on the far side of the globe', () => {
    // Same dot test leaderLine.ts and raycaster.ts already use. Without it
    // the destination marker floats over the ocean on the near face while
    // the airport is behind the planet.
    expect(projectMarker({ lat: 0, lon: 180 }, camera(), 800, 600).visible).toBe(false);
  });

  it('draws one button per end, labelled D and A', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(SPECS, camera(), 800, 600);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(container.textContent).toContain('D');
    expect(container.textContent).toContain('A');
    expect(buttons[0]?.getAttribute('aria-label')).toMatch(/departure.*JFK/i);
    expect(buttons[1]?.getAttribute('aria-label')).toMatch(/arrival.*LHR/i);
  });

  // The four below assert what update() WRITES, not what the pure helpers
  // return. projectMarker and markerLabelVisible were already covered as
  // functions, which left update() free to ignore both of them and free to
  // paint either letter on either button: the aria-labels come from
  // END_WORD, and container.textContent contains a D and an A whichever
  // dot carries which.

  it('puts D on the departure button and A on the arrival button', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(NEAR_PAIR, camera(), 800, 600);
    expect(container.querySelector('.marker[data-end="origin"] .marker__dot')?.textContent).toBe(
      'D'
    );
    expect(
      container.querySelector('.marker[data-end="destination"] .marker__dot')?.textContent
    ).toBe('A');
  });

  it('hides the marker whose airport is behind the globe', () => {
    // The dot test exists so a marker does not float over the near face
    // while its airport is behind the planet. SPECS already puts LHR at
    // lon 180, i.e. on the far side from a camera on +Z.
    const markers = createAirportMarkers(container, () => {});
    markers.update(SPECS, camera(), 800, 600);
    expect(container.querySelector<HTMLElement>('.marker[data-end="origin"]')?.style.display).toBe(
      ''
    );
    expect(
      container.querySelector<HTMLElement>('.marker[data-end="destination"]')?.style.display
    ).toBe('none');
  });

  it('drops the IATA label when the camera pulls back', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(NEAR_PAIR, camera(3.2), 800, 600);
    const label = container.querySelector<HTMLElement>('.marker[data-end="origin"] .marker__label');
    expect(label?.style.display).toBe('');
    markers.update(NEAR_PAIR, camera(9.8), 800, 600);
    expect(label?.style.display).toBe('none');
  });

  it('re-places the marker every frame instead of freezing it', () => {
    // Nothing is anchored and nothing is cached: the position is projected
    // afresh every frame, which is what makes zoom, rotation, damping and
    // resize correct without a single listener. A placement computed once
    // per end leaves both markers where they first landed.
    const markers = createAirportMarkers(container, () => {});
    markers.update(NEAR_PAIR, camera(4.6), 800, 600);
    const node = container.querySelector<HTMLElement>('.marker[data-end="destination"]');
    const first = node?.style.transform;
    expect(first).toBeTruthy();
    markers.update(NEAR_PAIR, camera(3.3), 800, 600);
    expect(node?.style.transform).not.toBe(first);
  });

  it('reports which end was clicked', () => {
    const onPick = vi.fn();
    const markers = createAirportMarkers(container, onPick);
    markers.update(SPECS, camera(), 800, 600);
    container.querySelector<HTMLButtonElement>('button')?.click();
    expect(onPick).toHaveBeenCalledWith('origin');
  });

  it('clears both markers when nothing is in focus', () => {
    const markers = createAirportMarkers(container, () => {});
    markers.update(SPECS, camera(), 800, 600);
    markers.update([], camera(), 800, 600);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
