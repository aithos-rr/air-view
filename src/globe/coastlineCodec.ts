/**
 * The coastline binary format: encoder and decoder, in one file.
 *
 * One file because the format is one thing. Two would be two authorities on
 * it, which is the defect this repo has already paid for twice — and the
 * worst possible place for it, because a decoder that disagrees with its
 * encoder does not raise an error, it draws a coastline that is not there.
 *
 * No imports, no fetch, no DOM: the network lives in coastlineFine.ts and
 * this module is exercised in Node by the build script and by its own test.
 *
 * ## Layout
 *
 * ```
 * offset  type    field
 *   0     u8[4]   magic "AVC1"
 *   4     u16     version = 1
 *   6     u16     reserved = 0
 *   8     u32     unitsPerDegree = 100000      (1e-5 deg = 1,1 m)
 *  12     u32     ringCount
 *  16     u32     pointCount        — over all rings
 *  20     ...     per ring:  u32 runCount
 *                   per run:   i32 lon0, i32 lat0, u32 deltaCount
 *                              deltaCount × (i16 dLon, i16 dLat)
 * ```
 *
 * All integers little-endian.
 *
 * ## Counted runs, not sentinels
 *
 * A RUN is one absolute point followed by as many deltas as fit in an Int16.
 * When a delta overflows, the run ends and another begins.
 *
 * The first draft of this format tagged absolute points with a leading
 * `u8 = 0xFF` and left the decoder to tell them from deltas by PEEKING at
 * the first byte. That cannot work. A delta point is `i16 dLon, i16 dLat`
 * little-endian, so its first byte is the low byte of `dLon`: every `dLon`
 * with `(dLon & 0xFF) === 0xFF` produces exactly that byte. 256 values out of
 * 65 536, one every 128 — and among them `dLon = -1`, about 1,1 m west, the
 * commonest delta a coastline produces at all. A decoder would have read
 * nine bytes instead of four, lost alignment, and from there drawn a world
 * that does not exist, with no error and no warning (D40/D42). Big-endian
 * does not save it either: there the first byte is the HIGH byte, which is
 * 0xFF for every dLon between -256 and -1.
 *
 * A sentinel outside the value range — `dLon = -32768` — would have worked,
 * and was rejected for a reason worth more than the 18 KB it saves: it moves
 * correctness from the FORMAT to the ENCODER. The decoder cannot check that
 * the value was never emitted, only trust it, and anyone who later widened
 * the delta range would reopen the hole without touching the decoder, and
 * again in silence. Counts make the ambiguity structurally impossible: the
 * cursor never looks at content to know where to go, because every byte's
 * role is decided by numbers already read.
 *
 * Counts pay for two more things. The length is computable in advance —
 * `encodedByteLength` — so a truncated file is caught by comparison rather
 * than by a crash; and `pointCount` in the header is the one preallocation
 * needed, so nothing grows an array 524 028 times.
 *
 * The price, counted: a run header costs 12 bytes where the tagged record
 * cost 9. On the measured corpus — 4 095 rings, 524 028 points, 6 029
 * absolute, 517 999 deltas — that is 2 160 744 bytes against 2 142 653:
 * +18 091, +0,84 %. It is the difference between a file that decodes and one
 * that does not.
 */

export const COASTLINE_MAGIC = 'AVC1';
export const COASTLINE_VERSION = 1;
/** 1e-5 degrees = 1,1 m, two orders of magnitude below a pixel at the bottom
 *  of the camera's travel (0,0989 NM/px at CAMERA_NEAR_LIMIT). */
export const COASTLINE_UNITS_PER_DEGREE = 100_000;

const HEADER_BYTES = 20;
const RUN_HEADER_BYTES = 12;
const DELTA_BYTES = 4;
const I16_MIN = -32_768;
const I16_MAX = 32_767;

/** The file this codec reads, named in every error it throws. */
const FILE_NAME = 'public/data/coastline-10m.bin';

function fitsInt16(v: number): boolean {
  return v >= I16_MIN && v <= I16_MAX;
}

/**
 * How many runs a ring breaks into, and how long each is.
 *
 * Walked identically by encodedByteLength and encodeCoastline, so the length
 * promised in advance is the length written — which is the whole reason a
 * truncation is a comparison here rather than a crash.
 */
function runsOf(ring: Int32Array): Array<{ start: number; count: number }> {
  const points = ring.length >> 1;
  const runs: Array<{ start: number; count: number }> = [];
  let i = 0;
  while (i < points) {
    const start = i;
    let count = 0;
    let j = i + 1;
    while (j < points) {
      const dLon = ring[j * 2]! - ring[(j - 1) * 2]!;
      const dLat = ring[j * 2 + 1]! - ring[(j - 1) * 2 + 1]!;
      if (!fitsInt16(dLon) || !fitsInt16(dLat)) break;
      count++;
      j++;
    }
    runs.push({ start, count });
    i = j;
  }
  return runs;
}

/** The exact byte length encodeCoastline will produce for these rings. */
export function encodedByteLength(rings: Int32Array[]): number {
  let bytes = HEADER_BYTES;
  for (const ring of rings) {
    bytes += 4; // runCount
    for (const run of runsOf(ring)) {
      bytes += RUN_HEADER_BYTES + run.count * DELTA_BYTES;
    }
  }
  return bytes;
}

/**
 * @param rings each a flat Int32Array of [lon, lat] pairs in
 *   1/COASTLINE_UNITS_PER_DEGREE of a degree.
 */
export function encodeCoastline(rings: Int32Array[]): ArrayBuffer {
  const buffer = new ArrayBuffer(encodedByteLength(rings));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < 4; i++) bytes[i] = COASTLINE_MAGIC.charCodeAt(i);
  view.setUint16(4, COASTLINE_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, COASTLINE_UNITS_PER_DEGREE, true);
  view.setUint32(12, rings.length, true);
  let pointCount = 0;
  for (const ring of rings) pointCount += ring.length >> 1;
  view.setUint32(16, pointCount, true);

  let at = HEADER_BYTES;
  for (const ring of rings) {
    const runs = runsOf(ring);
    view.setUint32(at, runs.length, true);
    at += 4;
    for (const run of runs) {
      view.setInt32(at, ring[run.start * 2]!, true);
      view.setInt32(at + 4, ring[run.start * 2 + 1]!, true);
      view.setUint32(at + 8, run.count, true);
      at += RUN_HEADER_BYTES;
      for (let k = 1; k <= run.count; k++) {
        const p = run.start + k;
        view.setInt16(at, ring[p * 2]! - ring[(p - 1) * 2]!, true);
        view.setInt16(at + 2, ring[p * 2 + 1]! - ring[(p - 1) * 2 + 1]!, true);
        at += DELTA_BYTES;
      }
    }
  }
  return buffer;
}

/**
 * The inverse, and it never peeks.
 *
 * Every advance is `12 + 4 × deltaCount` from a count already read, so no
 * byte's role is decided by its own value. At the end it demands BOTH that
 * the points written are `pointCount` and that the cursor is exactly
 * `byteLength`, and throws naming the file if either fails — half-decoded
 * data is worse than none, because it draws a coastline nobody can tell from
 * the real one (D42).
 */
export function decodeCoastline(buffer: ArrayBuffer): { rings: Int32Array[] } {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error(`${FILE_NAME}: truncated (${buffer.byteLength} bytes, header is ${HEADER_BYTES})`);
  }
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== COASTLINE_MAGIC.charCodeAt(i)) {
      throw new Error(`${FILE_NAME}: not a coastline file (bad magic)`);
    }
  }
  const version = view.getUint16(4, true);
  if (version !== COASTLINE_VERSION) {
    throw new Error(`${FILE_NAME}: version ${version}, this build reads ${COASTLINE_VERSION}`);
  }
  const unitsPerDegree = view.getUint32(8, true);
  if (unitsPerDegree !== COASTLINE_UNITS_PER_DEGREE) {
    throw new Error(
      `${FILE_NAME}: unitsPerDegree ${unitsPerDegree}, this build reads ${COASTLINE_UNITS_PER_DEGREE}`
    );
  }
  const ringCount = view.getUint32(12, true);
  const pointCount = view.getUint32(16, true);

  const rings: Int32Array[] = [];
  let at = HEADER_BYTES;
  let written = 0;
  for (let r = 0; r < ringCount; r++) {
    if (at + 4 > buffer.byteLength) throw new Error(`${FILE_NAME}: truncated in ring ${r}`);
    const runCount = view.getUint32(at, true);
    at += 4;

    // Two passes over this ring's runs: the first only reads the counts, so
    // the ring is allocated once at its real size.
    let ringPoints = 0;
    let scan = at;
    for (let k = 0; k < runCount; k++) {
      if (scan + RUN_HEADER_BYTES > buffer.byteLength) {
        throw new Error(`${FILE_NAME}: truncated in ring ${r}, run ${k}`);
      }
      const deltaCount = view.getUint32(scan + 8, true);
      ringPoints += 1 + deltaCount;
      scan += RUN_HEADER_BYTES + deltaCount * DELTA_BYTES;
      if (scan > buffer.byteLength) {
        throw new Error(`${FILE_NAME}: truncated in ring ${r}, run ${k}`);
      }
    }

    const ring = new Int32Array(ringPoints * 2);
    let p = 0;
    for (let k = 0; k < runCount; k++) {
      let lon = view.getInt32(at, true);
      let lat = view.getInt32(at + 4, true);
      const deltaCount = view.getUint32(at + 8, true);
      at += RUN_HEADER_BYTES;
      ring[p * 2] = lon;
      ring[p * 2 + 1] = lat;
      p++;
      for (let d = 0; d < deltaCount; d++) {
        lon += view.getInt16(at, true);
        lat += view.getInt16(at + 2, true);
        at += DELTA_BYTES;
        ring[p * 2] = lon;
        ring[p * 2 + 1] = lat;
        p++;
      }
    }
    written += ringPoints;
    rings.push(ring);
  }

  if (written !== pointCount) {
    throw new Error(`${FILE_NAME}: header says ${pointCount} points, the runs hold ${written}`);
  }
  if (at !== buffer.byteLength) {
    throw new Error(
      `${FILE_NAME}: ${buffer.byteLength - at} bytes left over after ${ringCount} rings`
    );
  }
  return { rings };
}
