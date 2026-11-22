import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sphere,
  Vector3,
} from 'three';
import { GLOBE_RADIUS, latLonToVec3, slerpUnit } from './geoHelpers';

export interface GeoPointDeg {
  lat: number;
  lon: number;
}

export interface DrawableArc {
  origin: GeoPointDeg;
  destination: GeoPointDeg;
  /** Where the aircraft is, or null when the flight is outside coverage. */
  aircraft: GeoPointDeg | null;
}

/** #2997ff — the single accent, shared with the selected aircraft. */
export const ARC_COLOR: [number, number, number] = [0.16, 0.59, 1.0];

/** Below this a short hop looks like a polyline; above it a polar route is wasted vertices. */
export const MIN_ARC_SAMPLES = 24;
export const MAX_ARC_SAMPLES = 256;

const FLOWN_BRIGHTNESS = 0.3;
const AHEAD_BRIGHTNESS = 1.0;

/**
 * How high the arc rides, as FRACTIONS of the per-frame altitude shell.
 *
 * These were three absolute offsets — 0,018, 0,012 and 0,055 — chosen when
 * the camera could not come closer than 1,9 and nothing above the surface
 * had to move. At 1,55 they put the apex of a short hop 0,019044 from the
 * camera, i.e. INSIDE a near plane of 0,02, and the apex of a near
 * antipodal route 0,033871 BEHIND it: the user asks to be taken to a
 * flight, arrives, and the route they asked for is not drawn (§2.7, D46).
 *
 * As ratios of SHELL_UNITS_FAR = 0,075 they are 0,24 / 0,16 / 11:15, and at
 * CAMERA_FAR_LIMIT the products are 0,018, 0,012 and 0,055 EXACTLY — not
 * nearly: the test asserts === and not toBeCloseTo.
 *
 * 0,24 is below the shell's own 1/3 floor on purpose. An arc has to pass
 * UNDER the aeroplane flying it and OVER the coastline (D47), which is a
 * different shape from the aircraft shell on the same thickness — so this
 * file does not call shellOffset, it takes shellUnits and states its own
 * shape, once.
 */
export const ARC_BASE_FRAC = 0.018 / 0.075;
export const ARC_APEX_MIN_FRAC = 0.012 / 0.075;
export const ARC_APEX_RANGE_FRAC = 0.055 / 0.075;

/** Angle at the centre of the Earth between two points, in radians. */
export function greatCircleRad(a: GeoPointDeg, b: GeoPointDeg): number {
  const va = latLonToVec3(a.lat, a.lon, 1).normalize();
  const vb = latLonToVec3(b.lat, b.lon, 1).normalize();
  return Math.acos(Math.min(1, Math.max(-1, va.dot(vb))));
}

export function arcSampleCount(omegaRad: number): number {
  const wanted = Math.round((omegaRad / Math.PI) * MAX_ARC_SAMPLES);
  return Math.min(MAX_ARC_SAMPLES, Math.max(MIN_ARC_SAMPLES, wanted));
}

/** Why slerp cannot draw a line between two points. */
export type ArcDegeneracy = 'samePlace' | 'antipodal' | 'unmeasurable';

/**
 * The pairs a geodesic cannot be drawn through, named rather than merely
 * refused.
 *
 * Coincident and antipodal pairs both make sin(omega) zero, and an
 * unguarded slerp writes NaN into a position buffer. geodesicPoints() has
 * always dropped them — silently, with setDrawRange(0, 0) — which is fine
 * for the renderer and useless to everyone else: 13 of the 4 243 routes in
 * the committed cache depart and arrive at the SAME airport, and for those
 * the card announced "CDG → CDG" over a globe that drew nothing, with
 * nothing on screen joining the two (D15a). Exported so a caller can refuse
 * the arc at the source and SAY why, instead of handing over an arc that
 * disappears downstream.
 *
 * 1e-6 rad is about 6 m on the Earth's surface: two ends closer than that
 * are one point, and two markers on them are one pixel.
 */
export function arcDegeneracy(a: GeoPointDeg, b: GeoPointDeg): ArcDegeneracy | null {
  const omega = greatCircleRad(a, b);
  if (!Number.isFinite(omega)) return 'unmeasurable';
  if (omega < 1e-6) return 'samePlace';
  if (omega > Math.PI - 1e-6) return 'antipodal';
  return null;
}

/**
 * The great circle between two airports, sampled by slerp.
 *
 * Slerp between two unit vectors IS the great circle, by definition, and
 * geoHelpers already produces those vectors. The alternative — interpolating
 * lat and lon linearly, which continents.ts does for coastlines over 2°
 * segments — draws the rhumb line: measured on JFK->LHR it puts the
 * midpoint at 46,06 N instead of 52,21 N, south of London instead of north
 * of it. Real routes curve on the sphere and drawing them straight is a lie
 * anyone who knows the North Atlantic tracks can see.
 *
 * Returns null for coincident and antipodal pairs. Both make sin(omega)
 * zero, and an unguarded slerp would write NaN into a position buffer:
 * invisible geometry, no error, nobody notices for months. The test itself
 * lives in arcDegeneracy() — ONE rule, so that whoever decides whether to
 * offer an arc and whoever draws it cannot disagree.
 */
export function geodesicPoints(
  a: GeoPointDeg,
  b: GeoPointDeg,
  shellUnits: number
): Vector3[] | null {
  if (arcDegeneracy(a, b) !== null) return null;
  const omega = greatCircleRad(a, b);

  const va = latLonToVec3(a.lat, a.lon, 1).normalize();
  const vb = latLonToVec3(b.lat, b.lon, 1).normalize();
  const samples = arcSampleCount(omega);
  const apexFrac = ARC_APEX_MIN_FRAC + ARC_APEX_RANGE_FRAC * (omega / Math.PI);

  // One scratch direction for the whole arc: slerpUnit writes in place, and
  // the sample itself is the allocation this loop cannot avoid.
  const dir = new Vector3();
  const out: Vector3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    // `omega` is passed in because this loop runs every frame while a flight
    // is in focus: letting slerpUnit recompute it would be an acos per
    // vertex, 256 of them, sixty times a second, for a number already here.
    slerpUnit(va, vb, t, omega, dir);
    const radius =
      GLOBE_RADIUS + shellUnits * (ARC_BASE_FRAC + apexFrac * Math.sin(Math.PI * t));
    out.push(new Vector3(dir.x * radius, dir.y * radius, dir.z * radius));
  }
  return out;
}

/**
 * How much of the route is behind the aircraft, 0..1.
 *
 * Measured as travelled angle over total angle — a real distance, not a
 * guess. A diverted aircraft off the great circle still produces an honest
 * "how far along", and the clamp keeps a flight past its destination from
 * indexing off the end of the buffer.
 */
export function flownFraction(a: GeoPointDeg, b: GeoPointDeg, at: GeoPointDeg): number {
  const total = greatCircleRad(a, b);
  if (total < 1e-9) return 0;
  return Math.min(1, Math.max(0, greatCircleRad(a, at) / total));
}

export interface RouteArcLayer {
  group: Group;
  /**
   * @param shellUnits the shell thickness for THIS frame, the same number
   *   the dots and the trails ride. The arc's own shape is stated in this
   *   file; the thickness it is scaled by has one author (D46).
   */
  update: (arc: DrawableArc | null, shellUnits: number) => void;
}

/**
 * One arc at a time: focus is about one flight, and the search ghost
 * replaces it rather than adding to it.
 */
export function createRouteArcLayer(): RouteArcLayer {
  const maxVertices = (MAX_ARC_SAMPLES - 1) * 2;
  const positions = new Float32Array(maxVertices * 3);
  const colors = new Float32Array(maxVertices * 3);

  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('color', colorAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), GLOBE_RADIUS + 0.5);

  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    // Same choice the trails make: the arc of the one flight in focus is
    // readable through the globe rather than cut in half by it.
    depthTest: false,
  });

  const lines = new LineSegments(geom, mat);
  lines.renderOrder = 5; // above the aircraft: in focus it IS the subject
  lines.frustumCulled = false;

  const group = new Group();
  group.add(lines);

  function writeVertex(i: number, p: Vector3, brightness: number): void {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    colors[i * 3] = ARC_COLOR[0] * brightness;
    colors[i * 3 + 1] = ARC_COLOR[1] * brightness;
    colors[i * 3 + 2] = ARC_COLOR[2] * brightness;
  }

  function update(arc: DrawableArc | null, shellUnits: number): void {
    if (arc === null) {
      geom.setDrawRange(0, 0);
      return;
    }
    const pts = geodesicPoints(arc.origin, arc.destination, shellUnits);
    if (pts === null) {
      geom.setDrawRange(0, 0);
      return;
    }
    // No aircraft on the arc means nothing has been "already flown" that we
    // know of — the off-coverage case of spec §6.3.2. One even brightness.
    const flown =
      arc.aircraft === null ? 0 : flownFraction(arc.origin, arc.destination, arc.aircraft);

    let v = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const tA = i / (pts.length - 1);
      const tB = (i + 1) / (pts.length - 1);
      const brightA = arc.aircraft !== null && tA < flown ? FLOWN_BRIGHTNESS : AHEAD_BRIGHTNESS;
      const brightB = arc.aircraft !== null && tB < flown ? FLOWN_BRIGHTNESS : AHEAD_BRIGHTNESS;
      writeVertex(v++, pts[i]!, brightA);
      writeVertex(v++, pts[i + 1]!, brightB);
    }
    geom.setDrawRange(0, v);
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  return { group, update };
}
