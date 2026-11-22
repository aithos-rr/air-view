import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COASTLINE_MAGIC,
  COASTLINE_UNITS_PER_DEGREE,
  COASTLINE_VERSION,
  decodeCoastline,
  encodeCoastline,
  encodedByteLength,
} from '@/globe/coastlineCodec';

/** A ring is a flat Int32Array of [lon, lat] pairs in 1e-5 degree units. */
function ring(lon0: number, lat0: number, deltas: Array<[number, number]>): Int32Array {
  const out = new Int32Array((deltas.length + 1) * 2);
  out[0] = lon0;
  out[1] = lat0;
  for (let i = 0; i < deltas.length; i++) {
    out[(i + 1) * 2] = out[i * 2]! + deltas[i]![0];
    out[(i + 1) * 2 + 1] = out[i * 2 + 1]! + deltas[i]![1];
  }
  return out;
}

function roundTrip(rings: Int32Array[]): Int32Array[] {
  return decodeCoastline(encodeCoastline(rings)).rings;
}

describe('the coastline format cannot be mis-framed', () => {
  it('round-trips a ring whose every delta is dLon = -1', () => {
    // THE case. -1 unit is 1,1 m west, the commonest delta a coastline
    // produces, and as an Int16 it is 0xFFFF — whose FIRST byte is 0xFF.
    // The first version of this format used 0xFF as the restart tag, so a
    // decoder peeking at that byte read nine bytes instead of four, lost
    // alignment, and from there drew a world that does not exist without
    // an error, a warning or a line in FeedStatus. Counts make that
    // unreachable, and this test is why the format has them (D40).
    const r = ring(900_000, 4_500_000, Array.from({ length: 64 }, () => [-1, -1] as [number, number]));
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips every single Int16 delta whose low byte is 0xFF', () => {
    // 256 of the 65 536 values collide with a 0xFF tag, one every 128.
    // Not one of them may be special.
    const nasty: Array<[number, number]> = [];
    for (let d = -32_768; d <= 32_767; d++) if ((d & 0xff) === 0xff) nasty.push([d, -d]);
    expect(nasty).toHaveLength(256);
    const r = ring(0, 0, nasty);
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips a ring that overflows Int16 in the middle, which is what a run break is for', () => {
    const r = ring(-1_000_000, 200_000, [
      [-1, -1],
      [900_000, -900_000], // no Int16 holds this: the run ends and another starts
      [-1, 0],
      [0, 32_767],
      [-32_768 + 1, 1],
    ]);
    expect(Array.from(roundTrip([r])[0]!)).toEqual(Array.from(r));
  });

  it('round-trips three rings and keeps them three', () => {
    const rings = [ring(0, 0, [[-1, -1]]), ring(17, -17, []), ring(-5, 5, [[1, 1], [-1, -1]])];
    const back = roundTrip(rings);
    expect(back).toHaveLength(3);
    rings.forEach((r, i) => expect(Array.from(back[i]!)).toEqual(Array.from(r)));
  });

  it('says in advance exactly how long the file will be', () => {
    // A length computed rather than discovered is how truncation gets
    // caught by comparison instead of by a crash.
    const rings = [ring(0, 0, [[-1, -1], [2, 2]]), ring(10, 10, [[70_000, 1]])];
    expect(encodeCoastline(rings).byteLength).toBe(encodedByteLength(rings));
  });

  it('keeps coordinates inside 1e-5 degrees through the round trip', () => {
    const lon = Math.round(9.18951 * COASTLINE_UNITS_PER_DEGREE);
    const lat = Math.round(45.46427 * COASTLINE_UNITS_PER_DEGREE);
    const back = roundTrip([ring(lon, lat, [[-1, 3]])])[0]!;
    expect(Math.abs(back[0]! / COASTLINE_UNITS_PER_DEGREE - 9.18951)).toBeLessThan(1e-5);
    expect(Math.abs(back[1]! / COASTLINE_UNITS_PER_DEGREE - 45.46427)).toBeLessThan(1e-5);
  });

  it('refuses a foreign file instead of drawing one', () => {
    const buf = encodeCoastline([ring(0, 0, [[1, 1]])]);
    new Uint8Array(buf)[0] = 0x00;
    expect(() => decodeCoastline(buf)).toThrow(/coastline-10m\.bin/);
  });

  it('refuses a version it was not written for', () => {
    const buf = encodeCoastline([ring(0, 0, [[1, 1]])]);
    new DataView(buf).setUint16(4, COASTLINE_VERSION + 1, true);
    expect(() => decodeCoastline(buf)).toThrow(/version/i);
  });

  it('refuses a truncated file instead of returning half a world', () => {
    // D42 from its worst side: half-decoded data is worse than none,
    // because it draws a coastline nobody can tell from the real one.
    const full = encodeCoastline([ring(0, 0, [[-1, -1], [-1, -1], [-1, -1]])]);
    expect(() => decodeCoastline(full.slice(0, full.byteLength - 2))).toThrow(/truncat/i);
  });

  it('refuses a file whose counts do not add up to its length', () => {
    const buf = encodeCoastline([ring(0, 0, [[-1, -1], [-1, -1]])]);
    new DataView(buf).setUint32(16, 99, true); // pointCount lies
    expect(() => decodeCoastline(buf)).toThrow();
  });

  it('declares the two numbers the build script shares with the client', () => {
    expect(COASTLINE_MAGIC).toBe('AVC1');
    expect(COASTLINE_UNITS_PER_DEGREE).toBe(100_000);
  });
});

/**
 * The one test a round trip cannot be.
 *
 * Every other test in this file is `decode(encode(x)) === x`, and that shape
 * has a hole big enough to drive the file through: encoder and decoder can
 * DRIFT TOGETHER and stay green by construction. Turning `true` to `false`
 * on all four DataView calls — the tidy-up of someone who believes
 * endianness is an internal detail — left 744 tests passing, decoded the
 * real artifact without throwing, matched its ring and point counts, and
 * drew Borneo at 118,0 degrees of longitude instead of 117,7 (D50).
 *
 * So: a byte vector computed BY HAND from the format, never from the
 * encoder, asserted in both directions. It is also what makes
 * COASTLINE_VERSION do its job — change the layout and this falls over,
 * which is the moment the version has to be raised.
 *
 * Little-endian throughout, and the layout, byte for byte:
 *   header   'AVC1' | u16 version | u16 pad | u32 unitsPerDegree |
 *            u32 ringCount | u32 pointCount
 *   ring     u32 runCount, then each run:
 *   run      i32 lon0 | i32 lat0 | u32 deltaCount | deltaCount x (i16, i16)
 */
const GOLDEN_RINGS = (): Int32Array[] => [
  // Three points: the first two a run apart by (+5, -10), the third 40 000
  // units east — past what an i16 delta can carry, so the encoder must
  // close the run and start another on an absolute point.
  new Int32Array([1000, 2000, 1005, 1990, 41005, 1990]),
  // A one-point ring: one run, zero deltas, and both coordinates negative,
  // which is where a sign error hides.
  new Int32Array([-7, -9]),
];

const GOLDEN_HEX =
  // header: magic, version 1, pad, 100 000, 2 rings, 4 points
  '41564331' + '0100' + '0000' + 'a0860100' + '02000000' + '04000000' +
  // ring 0: 2 runs
  '02000000' +
  //   run 0: lon 1000, lat 2000, 1 delta -> (+5, -10)
  'e8030000' + 'd0070000' + '01000000' + '0500' + 'f6ff' +
  //   run 1: lon 41005, lat 1990, 0 deltas
  '2da00000' + 'c6070000' + '00000000' +
  // ring 1: 1 run, lon -7, lat -9, 0 deltas
  '01000000' + 'f9ffffff' + 'f7ffffff' + '00000000';

function hexToBuffer(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('the format is a byte vector, not an agreement between two functions', () => {
  it('writes exactly these bytes', () => {
    expect(bufferToHex(encodeCoastline(GOLDEN_RINGS()))).toBe(GOLDEN_HEX);
  });

  it('reads exactly those bytes back', () => {
    const { rings } = decodeCoastline(hexToBuffer(GOLDEN_HEX));
    expect(rings.map((r) => Array.from(r))).toEqual(GOLDEN_RINGS().map((r) => Array.from(r)));
  });

  it('promises the length it wrote', () => {
    expect(encodedByteLength(GOLDEN_RINGS())).toBe(GOLDEN_HEX.length / 2);
  });

  it('carries the version this build reads, so a layout change has to raise it', () => {
    expect(new DataView(hexToBuffer(GOLDEN_HEX)).getUint16(4, true)).toBe(COASTLINE_VERSION);
  });
});

/**
 * Where the format and the file that actually ships meet — and until this
 * test they met nowhere.
 *
 * public/data/coastline-10m.bin is NOT a build artifact: railway.toml runs
 * `npm run build:all`, which never calls build:static, so the file in git is
 * the file served. Nothing read it in Node, and the e2e tests only ever
 * truncate it or answer 404 for it. Decoding it here costs 40 ms and is the
 * only check that the bytes committed in 2026 are still the bytes this code
 * believes in.
 */
describe('the artifact that ships decodes to the world it should', () => {
  it('is the 1:10 M coastline, with its first point on the coast of Borneo', () => {
    const file = readFileSync(join(process.cwd(), 'public/data/coastline-10m.bin'));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    expect(buffer.byteLength).toBe(2_002_164);

    const { rings } = decodeCoastline(buffer);
    expect(rings.length).toBe(4095);
    let points = 0;
    for (const r of rings) points += r.length >> 1;
    expect(points).toBe(483_485);

    // 117,70361 E, 4,16341 N, then two steps east along the same shore. Read
    // the deltas big-endian instead and the second point lands 30 km away,
    // on a coastline that does not exist and that nothing else would notice.
    expect(Array.from(rings[0]!.slice(0, 6))).toEqual([
      11_770_361, 416_341, 11_773_807, 415_724, 11_790_704, 415_668,
    ]);
  });
});
