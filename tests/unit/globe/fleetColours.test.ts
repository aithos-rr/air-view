import { describe, it, expect } from 'vitest';
import { CAMERA_FAR_LIMIT, shellThicknessUnits } from '@/globe/geoHelpers';
import type { Object3D, Points } from 'three';
import { PerspectiveCamera, Vector2 } from 'three';
import { createAircraftLayer, COMPLETE_COLOR, PARTIAL_COLOR } from '@/globe/aircraft';
import { createTrailsLayer } from '@/globe/trails';
import { findAircraftAtPointer } from '@/globe/raycaster';
import { SHOW_ALL } from '@/globe/visibility';
import type { VisibilityRule } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

function geometryOf(obj: Object3D | undefined): Points['geometry'] {
  if (!obj) throw new Error('layer has no drawable child');
  return (obj as Points).geometry;
}

/** children: [0] partial, [1] complete, [2] selected — the draw hierarchy. */
const PARTIAL = 0;
const COMPLETE = 1;
const SELECTED = 2;

describe('aircraft layer — the colour declares the data', () => {
  it('paints complete and partial aircraft differently', () => {
    // The server has been sending `complete` since Piano 1 and the globe
    // painted every aircraft #ffe6c4 regardless. A filter over two colours
    // nobody can tell apart is not a filter.
    expect(COMPLETE_COLOR).not.toEqual(PARTIAL_COLOR);
  });

  it('puts the greys in the bottom layer and the completes above them', () => {
    const layer = createAircraftLayer();
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      SHOW_ALL,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });

  it('draws the selected aircraft in its own set, above both', () => {
    const layer = createAircraftLayer();
    layer.update([ac({ icao24: 'a1', complete: true })], 'a1', SHOW_ALL, 1);
    expect(geometryOf(layer.group.children[SELECTED]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
  });

  it('draws nothing grey once the partial box is off', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      rule,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(0);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });

  it('draws nothing warm once the complete box is off', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: false, showPartial: true, focusedIcao: null };
    layer.update(
      [ac({ icao24: 'a1', complete: false }), ac({ icao24: 'a2', complete: true })],
      null,
      rule,
      1
    );
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
  });

  it('under focus draws the focused aircraft and nobody else', () => {
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    layer.update(
      [ac({ icao24: 'a1', complete: true }), ac({ icao24: 'a2', complete: true })],
      'a1',
      rule,
      0
    );
    expect(geometryOf(layer.group.children[SELECTED]).drawRange.count).toBe(1);
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(0);
    expect(geometryOf(layer.group.children[PARTIAL]).drawRange.count).toBe(0);
  });

  it('keeps drawing the others, dimmed, while the fade is still running', () => {
    // Mid-transition the others are still on screen at reduced brightness.
    // Skipping them the moment focus starts would make them vanish in one
    // frame — outside the 200-400ms editorial window of DESIGN.md.
    const layer = createAircraftLayer();
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    layer.update(
      [ac({ icao24: 'a1', complete: true }), ac({ icao24: 'a2', complete: true })],
      'a1',
      rule,
      0.5
    );
    expect(geometryOf(layer.group.children[COMPLETE]).drawRange.count).toBe(1);
  });
});

describe('trails layer — a hidden aircraft leaves no trail', () => {
  it('drops the trails of the aircraft the filter hides', () => {
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    const layer = createTrailsLayer();
    const grey = ac({
      icao24: 'a1',
      complete: false,
      trail: [{ lat: 1, lon: 1, t: 1 }, { lat: 2, lon: 2, t: 2 }],
    });
    layer.update([grey], null, rule, shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(geometryOf(layer.group.children[0]).drawRange.count).toBe(0);
  });

  it('keeps the trail of an aircraft the rule shows', () => {
    const layer = createTrailsLayer();
    const warm = ac({
      icao24: 'a1',
      complete: true,
      trail: [{ lat: 1, lon: 1, t: 1 }, { lat: 2, lon: 2, t: 2 }],
    });
    layer.update([warm], null, SHOW_ALL, shellThicknessUnits(CAMERA_FAR_LIMIT));
    expect(geometryOf(layer.group.children[0]).drawRange.count).toBeGreaterThan(0);
  });
});

describe('picking — an invisible aircraft does not answer a click', () => {
  function camera(): PerspectiveCamera {
    const c = new PerspectiveCamera(38, 800 / 600, 0.1, 100);
    c.position.set(0, 0, 4.6);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  }
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const centre = new Vector2(0, 0); // NDC centre, i.e. lat 0 / lon 0 on screen

  it('picks the aircraft under the pointer when the rule shows it', () => {
    const fleet = [ac({ icao24: 'a1', latitude: 0, longitude: 0, complete: true })];
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, SHOW_ALL)).toBe('a1');
  });

  it('refuses to pick one the filter has hidden', () => {
    // Without this the user switches the greys off, clicks the empty space
    // where one used to be, and a card opens for an aircraft that is not
    // on the screen.
    const fleet = [ac({ icao24: 'a1', latitude: 0, longitude: 0, complete: false })];
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, rule)).toBeNull();
  });

  it('under focus lets a click on another aircraft fall through to the exit', () => {
    // The others are invisible, so they are not pickable, so the click
    // misses everything and scene.ts calls select(null) — which IS the
    // "click on empty space" exit of spec §6.2, obtained for free.
    const fleet = [
      ac({ icao24: 'a1', latitude: 30, longitude: 30, complete: true }),
      ac({ icao24: 'a2', latitude: 0, longitude: 0, complete: true }),
    ];
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    expect(findAircraftAtPointer(centre, fleet, camera(), canvas, rule)).toBeNull();
  });
});

describe('the layer reports exactly what it put in the buffers (D15)', () => {
  it('matches its VisibleFleet to the vertices it actually drew, in every state', () => {
    // The table in tests/unit/globe/visibleFleet.test.ts proves the walk is
    // self-consistent. THIS proves the walk is what the GPU receives: the
    // number the panel will print, compared against the three draw ranges
    // the renderer committed. If a future edit teaches this file to skip an
    // aircraft on its own again, the two stop matching here.
    const fleet = [
      ac({ icao24: 'cc', complete: true }),
      ac({ icao24: 'pp', complete: false }),
      ac({ icao24: 'cn', complete: true, latitude: null }),
      ac({ icao24: 'pn', complete: false, longitude: null }),
    ];
    const states: Array<[VisibilityRule, string | null]> = [
      [{ showComplete: true, showPartial: true, focusedIcao: null }, null],
      [{ showComplete: true, showPartial: false, focusedIcao: null }, null],
      [{ showComplete: false, showPartial: true, focusedIcao: null }, null],
      [{ showComplete: false, showPartial: false, focusedIcao: null }, null],
      [{ showComplete: true, showPartial: true, focusedIcao: 'cc' }, 'cc'],
      [{ showComplete: false, showPartial: false, focusedIcao: 'cc' }, 'cc'],
      [{ showComplete: true, showPartial: false, focusedIcao: 'pp' }, 'pp'],
    ];

    for (const [rule, selected] of states) {
      const layer = createAircraftLayer();
      // The SETTLED brightness of each state — 0 under a focus, 1 without
      // one — which is exactly what the panel passes when it passes
      // nothing. A flat 0 here would be a frame the fade never produces:
      // with no focus in force the crowd is never dark, because the return
      // from a focus is not animated (D15, Task 4 Step 3).
      const view = layer.update(fleet, selected, rule, rule.focusedIcao !== null ? 0 : 1);
      const drawn =
        geometryOf(layer.group.children[PARTIAL]).drawRange.count +
        geometryOf(layer.group.children[COMPLETE]).drawRange.count +
        geometryOf(layer.group.children[SELECTED]).drawRange.count;
      // Compared as an object so a failure names the state that broke.
      expect({ rule, drawn }).toEqual({ rule, drawn: view.shown });
    }
  });
});
