import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';
import { COASTLINE_LIFT, COASTLINE_MAX_SEGMENT_DEG, GLOBE_RADIUS, latLonToVec3 } from './geoHelpers';
import { COASTLINE_UNITS_PER_DEGREE, decodeCoastline } from './coastlineCodec';
import { useDetailStore } from '@/state/detailStore';

/**
 * 10° buckets: 359 non-empty on the real data, at most 131 722 vertices in
 * view at the switch distance — fewer than the 186 010 the 50m level pushes
 * at EVERY frame today. 5° would be 100 094 but 954 scene objects instead of
 * 359, and the number that matters is under the 50m figure either way (D41).
 */
export const BUCKET_DEGREES = 10;
/** 36 columns of longitude by 18 rows of latitude. */
export const BUCKET_COUNT = (360 / BUCKET_DEGREES) * (180 / BUCKET_DEGREES);
/**
 * Where the fine level replaces the coarse one. Measured: the 50m mean
 * segment is 7,03 px here and 11,3 px at 1,75 — past that a coast stops
 * reading as a coast and reads as a polygon, which is what the user is
 * looking at now. Above it, 43 % and more of the 10m segments are sub-pixel:
 * detail paid for and not seen (D41).
 */
export const FINE_SWITCH_DISTANCE = 1.9;
/**
 * Where the download starts: 1,91 MB at 10 Mbit/s is 1,6 s and the chunked
 * build takes 0,25 s more, so it begins before it is needed.
 */
export const FINE_PREFETCH_DISTANCE = 2.6;
/**
 * 0,0626 µs per vertex measured, so 64 000 is 4,0 ms — a quarter of a
 * 16,7 ms frame. One 65,1 ms pass would be four dropped frames at the exact
 * moment the user is zooming.
 */
export const FINE_BUILD_CHUNK_VERTICES = 64_000;
/**
 * The editorial window DESIGN.md sets, the one FOCUS_FADE_MS and RECONCILE_MS
 * already occupy. On the rAF clock, never Date.now() — that clock jumps about
 * 528 ms every 32 s on this machine.
 */
export const FINE_CROSSFADE_MS = 300;

/** The one material every bucket shares: 359 geometries, one draw state. */
function fineMaterial(): LineBasicMaterial {
  // Identical to continents.ts down to the opacity: "keep the same graphics"
  // means the fine outline must be indistinguishable from the coarse one
  // except in detail, or the crossfade would be a change of style rather
  // than a change of resolution.
  return new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
}

/**
 * Which 10° cell this point falls in.
 *
 * Cells are half-open in both axes, and the two edges are handled
 * differently because they ARE different. Longitude WRAPS: +180 and -180 are
 * one meridian, so a point there belongs to the cell that starts at -180,
 * not to a 37th column. Latitude CLAMPS: there is no cell above the pole.
 *
 * Neither is decoration. A floor() that lets lat = 90 or lon = 180 index one
 * cell past the end does not throw in JavaScript — it writes into a bucket
 * nobody draws, and a strip of coastline disappears with no error, no
 * warning and no line in FeedStatus (D42).
 */
export function bucketIndex(lat: number, lon: number): number {
  const cols = 360 / BUCKET_DEGREES;
  const rows = 180 / BUCKET_DEGREES;
  const rawCol = Math.floor((lon + 180) / BUCKET_DEGREES);
  const col = ((rawCol % cols) + cols) % cols;
  const row = Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / BUCKET_DEGREES)));
  return row * cols + col;
}

/**
 * The unit direction through the centre of this bucket.
 *
 * Computed once per bucket when the file is decoded — 36 × 18 × 4
 * transcendental calls, one time — because the per-frame decision is then a
 * single dot product and nothing else (D41).
 */
export function bucketCentreDirection(index: number): Vector3 {
  const cols = 360 / BUCKET_DEGREES;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const lon = -180 + (col + 0.5) * BUCKET_DEGREES;
  const lat = -90 + (row + 0.5) * BUCKET_DEGREES;
  return latLonToVec3(lat, lon, 1).normalize();
}

/**
 * Half the angular diagonal of a 10° cell, in radians.
 *
 * A cell's centre can be this far from its farthest corner, so a bucket is
 * visible whenever its centre is within cap + this. Over-reaching costs
 * vertices; under-reaching costs a piece of coast, which is the error that
 * must not happen (D42) — so the bound is the worst case over the sphere,
 * at the equator, where a 10° cell is widest.
 */
const BUCKET_HALF_DIAGONAL_RAD = Math.sqrt(2) * ((BUCKET_DEGREES / 2) * Math.PI) / 180;

/** The per-frame decision: one dot product, no transcendental call. */
export function bucketVisible(
  index: number,
  cameraDir: Vector3,
  capHalfAngleRad: number,
  centres: Vector3[] = DEFAULT_CENTRES
): boolean {
  const c = centres[index];
  if (c === undefined) return false;
  // cos is monotone decreasing, so comparing cosines compares angles — and
  // Math.cos of the threshold is the only trig here, hoisted by the caller
  // in the hot path below.
  const limit = capHalfAngleRad + BUCKET_HALF_DIAGONAL_RAD;
  if (limit >= Math.PI) return true;
  return c.dot(cameraDir) >= Math.cos(limit);
}

const DEFAULT_CENTRES: Vector3[] = Array.from({ length: BUCKET_COUNT }, (_, i) =>
  bucketCentreDirection(i)
);

/**
 * Where the two levels are, `elapsed` ms into the crossfade.
 *
 * `elapsed` is measured on the requestAnimationFrame timestamp, which is
 * monotonic by specification; Date.now() is not, and on this machine it
 * jumps about 528 ms every 32 s.
 *
 * With `animate` false — prefers-reduced-motion — the swap is instant, which
 * is the same rule FOCUS_FADE_MS and RECONCILE_MS follow (D30).
 */
export function crossfade(elapsedMs: number, animate: boolean): { coarse: number; fine: number } {
  if (!animate) return { coarse: 0, fine: 1 };
  const t = Math.min(1, Math.max(0, elapsedMs / FINE_CROSSFADE_MS));
  return { coarse: 1 - t, fine: t };
}

/**
 * One segment of coastline, in the flat form the bucket pass counts and then
 * writes. Two passes, because counting first means every bucket's
 * Float32Array is allocated once at its real size.
 */
interface SegmentSource {
  rings: Int32Array[];
}

export interface FineCoastline {
  group: Group;
  /**
   * Hand the decoded rings over. Nothing is built yet: feedChunk does the
   * building, a frame at a time.
   */
  accept: (rings: Int32Array[]) => void;
  /**
   * Build at most `budgetVertices` vertices and return whether there is more
   * to do. One 65,1 ms pass would be four dropped frames at the exact moment
   * the user is zooming (D41).
   */
  feedChunk: (budgetVertices: number) => boolean;
  /** 0..1, driven by the crossfade. */
  setOpacity: (value: number) => void;
  /** Per frame: which buckets are drawn at all. */
  update: (cameraDir: Vector3, capHalfAngleRad: number) => void;
  ready: () => boolean;
}

/**
 * Subdivide one chord of the ring and push its vertices, exactly as
 * continents.ts does.
 *
 * The same COASTLINE_MAX_SEGMENT_DEG, and the same COASTLINE_LIFT, and
 * neither is written out here. The 10m data has a mean segment of 1,368 NM —
 * 0,023° — far below 2°, but the simplification at 0,0008° can leave long
 * chords where a coast runs straight, and one of those would sag below a
 * lift computed for 2°. Two coastlines at two heights would also come apart
 * during the 300 ms crossfade (D47).
 */
function pushChord(
  out: number[],
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radius: number
): void {
  if (Math.abs(lon2 - lon1) > 180) return; // antimeridian crossings
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const arc = Math.hypot(dLat, dLon);
  const steps = arc > COASTLINE_MAX_SEGMENT_DEG ? Math.ceil(arc / COASTLINE_MAX_SEGMENT_DEG) : 1;
  for (let s = 0; s < steps; s++) {
    const ta = s / steps;
    const tb = (s + 1) / steps;
    const v1 = latLonToVec3(lat1 + dLat * ta, lon1 + dLon * ta, radius);
    const v2 = latLonToVec3(lat1 + dLat * tb, lon1 + dLon * tb, radius);
    out.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  }
}

export function createFineCoastline(): FineCoastline {
  const group = new Group();
  const material = fineMaterial();
  const centres = DEFAULT_CENTRES;
  const meshes: Array<LineSegments | null> = Array.from({ length: BUCKET_COUNT }, () => null);

  let source: SegmentSource | null = null;
  let ringCursor = 0;
  let built = false;
  // One scratch array per bucket, filled across however many frames the
  // budget takes, flushed into geometry when the last ring is done.
  let pending: number[][] = [];

  function accept(rings: Int32Array[]): void {
    source = { rings };
    ringCursor = 0;
    built = false;
    pending = Array.from({ length: BUCKET_COUNT }, () => []);
  }

  function feedChunk(budgetVertices: number): boolean {
    if (source === null || built) return false;
    const radius = GLOBE_RADIUS + COASTLINE_LIFT;
    let spent = 0;
    const scratch: number[] = [];
    while (ringCursor < source.rings.length && spent < budgetVertices) {
      const ring = source.rings[ringCursor]!;
      const points = ring.length >> 1;
      for (let i = 0; i + 1 < points; i++) {
        const lon1 = ring[i * 2]! / COASTLINE_UNITS_PER_DEGREE;
        const lat1 = ring[i * 2 + 1]! / COASTLINE_UNITS_PER_DEGREE;
        const lon2 = ring[(i + 1) * 2]! / COASTLINE_UNITS_PER_DEGREE;
        const lat2 = ring[(i + 1) * 2 + 1]! / COASTLINE_UNITS_PER_DEGREE;
        scratch.length = 0;
        pushChord(scratch, lat1, lon1, lat2, lon2, radius);
        if (scratch.length === 0) continue;
        // The midpoint decides the bucket. The mean segment is 1,368 NM, so
        // no segment spans a meaningful part of a 10° cell.
        const bucket = bucketIndex((lat1 + lat2) / 2, (lon1 + lon2) / 2);
        const into = pending[bucket]!;
        for (const v of scratch) into.push(v);
        spent += scratch.length / 3;
      }
      ringCursor++;
    }
    if (ringCursor < source.rings.length) return true;

    for (let b = 0; b < BUCKET_COUNT; b++) {
      const verts = pending[b]!;
      if (verts.length === 0) continue;
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(verts, 3));
      const lines = new LineSegments(geom, material);
      // The same renderOrder the coarse level uses: during the crossfade the
      // two are the same picture at two resolutions, not two layers.
      lines.renderOrder = 2;
      lines.frustumCulled = false;
      meshes[b] = lines;
      group.add(lines);
    }
    pending = [];
    built = true;
    // NOW it is on screen. Announcing it when the bytes arrived would name a
    // level that is decoded and not yet drawn, which is the screen claiming
    // more than it shows (D15) — and the gap is 0,25 s of build, fifteen
    // frames of a line that is not true yet.
    //
    // If the load failed there is nothing to build and this is never
    // reached; and if it were, nextCoastline('coarse-only', 'fine') returns
    // 'coarse-only'. The store makes the lie unwritable instead of trusting
    // its caller.
    useDetailStore.getState().setCoastline('fine');
    return false;
  }

  function setOpacity(value: number): void {
    material.opacity = 0.45 * Math.min(1, Math.max(0, value));
    material.visible = material.opacity > 0;
  }

  function update(cameraDir: Vector3, capHalfAngleRad: number): void {
    if (!built) return;
    for (let b = 0; b < BUCKET_COUNT; b++) {
      const mesh = meshes[b];
      if (mesh == null) continue;
      mesh.visible = bucketVisible(b, cameraDir, capHalfAngleRad, centres);
    }
  }

  function ready(): boolean {
    return built;
  }

  return { group, accept, feedChunk, setOpacity, update, ready };
}

/**
 * The one network path of the fine level, and the one place that says what
 * happened on it.
 *
 * 'loading' BEFORE the request, because 1,91 MB at 10 Mbit/s plus a chunked
 * build is a second and a half of being in a state, not an instant. It
 * prints nothing on its own — a level on its way is not news — but it is
 * what makes 'fine' reachable at all (detailStore.ts).
 *
 * 'coarse-only' on every ending that is not the right one: a 404, a network
 * error, a truncated body that decodeCoastline refuses by name. The coarse
 * outline is still there and still correct, so this is not the globe
 * failing — it is ONE level failing, and the line on screen says which.
 */
export async function loadFineCoastline(): Promise<Int32Array[] | null> {
  useDetailStore.getState().setCoastline('loading');
  try {
    const res = await fetch('/data/coastline-10m.bin');
    if (!res.ok) throw new Error(`coastline-10m.bin: HTTP ${res.status}`);
    return decodeCoastline(await res.arrayBuffer()).rings;
  } catch (e) {
    console.warn('Fine coastline:', e);
    useDetailStore.getState().setCoastline('coarse-only');
    return null;
  }
}
