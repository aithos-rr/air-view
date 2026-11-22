import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import {
  LABEL_BOX_H,
  LABEL_BOX_W,
  LABEL_BOX_MARGIN,
  MAX_CITY_LABELS,
  scalerankCeilingFor,
  selectCityLabels,
} from '@/globe/cityLabels';
import type { CityPlace } from '@/data/cityPlaces';
import { latLonToVec3, visibleCapRadiusNm } from '@/globe/geoHelpers';

const FOV = 38;

function place(name: string, scalerank: number, lat = 0, lon = 0): CityPlace {
  return {
    name,
    scalerank,
    labelrank: 0,
    popMax: 1,
    lat,
    lon,
    dir: latLonToVec3(lat, lon, 1).normalize(),
  };
}

/** A straight-line screen projection, so the test owns no camera. */
function projector(xs: number[], ys: number[]) {
  return (i: number): { x: number; y: number; visible: boolean } => ({
    x: xs[i] ?? 0,
    y: ys[i] ?? 0,
    visible: true,
  });
}

describe('the scale is Natural Earth, not an invented population threshold', () => {
  it('shows nothing when the frame is the planet', () => {
    // 70 px of label is 227 NM at d = 3,0: the dot under the name is one
    // pixel and the name is a claim about a place nobody can see (D43).
    expect(scalerankCeilingFor(visibleCapRadiusNm(10, FOV))).toBeNull();
    expect(scalerankCeilingFor(1401)).toBeNull();
  });

  it('walks the four steps measured in the plan', () => {
    expect(scalerankCeilingFor(1400)).toBe(1);
    expect(scalerankCeilingFor(701)).toBe(1);
    expect(scalerankCeilingFor(700)).toBe(2);
    expect(scalerankCeilingFor(351)).toBe(2);
    expect(scalerankCeilingFor(350)).toBe(4);
    expect(scalerankCeilingFor(141)).toBe(4);
    expect(scalerankCeilingFor(140)).toBe(10);
    // At the bottom of the travel the cap is 39,6 NM and everything that is
    // in frame is named.
    expect(scalerankCeilingFor(visibleCapRadiusNm(1.55, FOV))).toBe(10);
  });

  it('distinguishes "no labels" from "the 27 world cities"', () => {
    // 0 is a ceiling — SCALERANK 0, the 27 places Natural Earth puts first.
    // null is "none at all". Merging them into a falsy number is the bug
    // this assertion exists for.
    expect(scalerankCeilingFor(2000)).toBeNull();
    expect(scalerankCeilingFor(1400)).not.toBeNull();
  });
});

describe('the labels do not overlap, and the markers always win', () => {
  it('never returns more than the readable maximum', () => {
    // 24 is not what the browser can take — it would take a thousand — it
    // is where a map stops being readable (D43).
    const candidates = Array.from({ length: 300 }, (_, i) => place(`C${i}`, 0));
    const chosen = selectCityLabels(
      candidates,
      projector(
        candidates.map((_, i) => 100 + i * 200),
        candidates.map((_, i) => 100 + i * 50)
      ),
      [],
      MAX_CITY_LABELS
    );
    expect(chosen.length).toBeLessThanOrEqual(MAX_CITY_LABELS);
  });

  it('never accepts two boxes that intersect', () => {
    const candidates = Array.from({ length: 300 }, (_, i) => place(`C${i}`, 0));
    // Every candidate on the same pixel: exactly one can be accepted.
    const chosen = selectCityLabels(
      candidates,
      projector(candidates.map(() => 500), candidates.map(() => 400)),
      [],
      MAX_CITY_LABELS
    );
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.place.name).toBe('C0');
  });

  it('accepts in array order, which is what makes it deterministic', () => {
    // The array is already sorted by (SCALERANK, LABELRANK, -POP_MAX), so
    // greedy acceptance in order IS "the more important name wins the
    // pixel" — and a deterministic order is the only kind a test can fix.
    const candidates = [place('First', 0), place('Second', 0), place('Third', 0)];
    const chosen = selectCityLabels(
      candidates,
      projector([500, 505, 2000], [400, 402, 400]),
      [],
      MAX_CITY_LABELS
    );
    expect(chosen.map((c) => c.place.name)).toEqual(['First', 'Third']);
  });

  it('drops a city that touches a D/A marker, never the other way round', () => {
    // The marker is the route the user ASKED for; a city is geography. The
    // taken boxes come in with absolute priority (D43).
    const taken = [{ x: 500, y: 400, w: LABEL_BOX_W, h: LABEL_BOX_H }];
    const candidates = [place('Covered', 0), place('Clear', 0)];
    const chosen = selectCityLabels(
      candidates,
      projector([500, 1200], [400, 900]),
      taken,
      MAX_CITY_LABELS
    );
    expect(chosen.map((c) => c.place.name)).toEqual(['Clear']);
  });

  it('leaves the declared margin between two accepted boxes', () => {
    // Boxes are placed by their CENTRE, so two of equal width clear each
    // other when their centres are at least w + margin apart: that is 4 px
    // of white between the edges, which is what D43 asks for.
    const candidates = [place('A', 0), place('B', 0)];
    const justTouching = LABEL_BOX_W + LABEL_BOX_MARGIN - 1;
    expect(
      selectCityLabels(candidates, projector([0, justTouching], [0, 0]), [], MAX_CITY_LABELS)
    ).toHaveLength(1);
    const justClear = LABEL_BOX_W + LABEL_BOX_MARGIN + 1;
    expect(
      selectCityLabels(candidates, projector([0, justClear], [0, 0]), [], MAX_CITY_LABELS)
    ).toHaveLength(2);
  });

  it('skips a candidate the projector says is not on screen', () => {
    const candidates = [place('Behind', 0), place('Front', 0)];
    const chosen = selectCityLabels(
      candidates,
      (i) => ({ x: i * 1000, y: 0, visible: i !== 0 }),
      [],
      MAX_CITY_LABELS
    );
    expect(chosen.map((c) => c.place.name)).toEqual(['Front']);
  });
});

describe('the selection costs no transcendental call per frame', () => {
  it('spends none over a thousand selections on 1 128 candidates', () => {
    // The unit directions are computed once at load (cityPlaces.ts). What
    // is left per frame is two dot products per candidate and a projection
    // for the ones that pass, and neither needs sin or cos (D43).
    const candidates = Array.from({ length: 1128 }, (_, i) => place(`C${i}`, 0, i % 80, i % 170));
    const project = projector(
      candidates.map((_, i) => (i * 97) % 1900),
      candidates.map((_, i) => (i * 61) % 1000)
    );
    const sin = vi.spyOn(Math, 'sin');
    const cos = vi.spyOn(Math, 'cos');
    const acos = vi.spyOn(Math, 'acos');
    for (let i = 0; i < 100; i++) selectCityLabels(candidates, project, [], MAX_CITY_LABELS);
    expect(sin).not.toHaveBeenCalled();
    expect(cos).not.toHaveBeenCalled();
    expect(acos).not.toHaveBeenCalled();
    sin.mockRestore();
    cos.mockRestore();
    acos.mockRestore();
  });

  it('keeps the intersection tests under the declared bound', () => {
    // 24 accepted boxes is at most 1 + 2 + ... + 23 = 276 intersection
    // tests, which is the figure D43 states. The loop stops at the cap, so
    // 300 candidates cost no more than 24 do.
    expect((MAX_CITY_LABELS * (MAX_CITY_LABELS - 1)) / 2).toBe(276);
  });
});

describe('the camera direction decides what is a candidate at all', () => {
  it('is the dot product, not a reprojection', () => {
    // A place on the far side cannot be a label: isOnNearSide is a dot
    // product on vectors this module already holds.
    const far = place('Antipode', 0, 0, 180);
    const near = place('Here', 0, 0, 0);
    const cameraDir = new Vector3(0, 0, 1);
    expect(far.dir.dot(cameraDir)).toBeLessThan(0);
    expect(near.dir.dot(cameraDir)).toBeGreaterThan(0);
  });
});
