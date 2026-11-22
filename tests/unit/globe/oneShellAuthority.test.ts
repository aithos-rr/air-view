import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GLOBE_DIR = join(process.cwd(), 'src/globe');
const FILES = readdirSync(GLOBE_DIR).filter((f) => f.endsWith('.ts'));

/**
 * The file with its comment lines removed.
 *
 * This suite reads source instead of calling it, so it has to say which
 * occurrences count. A number QUOTED in a comment to record what changed
 * and why is this plan's house style and must stay legal; the same number
 * in an expression is a second authority and must not. The line test is
 * crude on purpose — a block comment's continuation lines start with `*`,
 * and nothing in src/globe hides code behind one.
 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');
}

/**
 * The altitude shell had THREE copies before this task: geoHelpers.ts:44,
 * aircraft.ts:270 and trails.ts:202, the last two inlined inside private
 * writeLatLonAlt helpers that nothing named. The price is not abstract: a
 * shell that thins with the zoom would have reached the dots and not the
 * trails, so every aircraft would have flown detached from its own trail
 * at every zoom, and nothing in this repo could have reported it. This
 * project has paid three times for TWO copies of a number (D24, D25, D37);
 * here there were three.
 */
describe('the altitude shell has exactly one authority', () => {
  it('names 41 000 ft in geoHelpers.ts and nowhere else under src/globe', () => {
    const offenders = FILES.filter(
      (f) => f !== 'geoHelpers.ts' && /41[ _]?000/.test(readFileSync(join(GLOBE_DIR, f), 'utf8'))
    );
    // Comments count. A number quoted in a comment is a number somebody
    // will update in one place out of three.
    expect(offenders).toEqual([]);
  });

  it('writes the old 0,025 / 0,05 shell literals nowhere at all', () => {
    // They do not survive even in geoHelpers: the thickness is
    // SHELL_UNITS_NEAR / SHELL_UNITS_FAR and the shape is 1/3 + 2/3 (D36).
    //
    // Through codeOnly, like the two assertions below it and for the reason
    // codeOnly states: shellOffset's own doc comment QUOTES
    // `GLOBE_RADIUS + 0.025 + (altFt/41000)*0.05` to say what the three
    // copies used to be, and that sentence is this plan's house style. A
    // raw read of the file would have made the prescribed comment and the
    // prescribed test contradict each other, with the number the test is
    // about present only where it is documentation.
    for (const f of FILES) {
      expect(codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8')), f).not.toMatch(/0\.025\s*\+/);
    }
  });

  it('makes every layer that draws an aircraft compose through shellOffset', () => {
    // aircraft.ts and trails.ts keep their allocation-free writeLatLonAlt —
    // that part was always right — and take the offset from the one
    // function that owns it. deadReckoning.ts is in this list because
    // positionAt is where the radius is finally composed, and an earlier
    // draft of this plan had positionAt spell `shellUnits * (1/3 + 2/3 *
    // m.altFrac)` out by hand — a FOURTH copy, written in the very step
    // whose purpose was to delete three, and in direct contradiction with
    // this assertion (D36).
    for (const f of ['aircraft.ts', 'trails.ts', 'deadReckoning.ts']) {
      expect(readFileSync(join(GLOBE_DIR, f), 'utf8'), f).toMatch(/shellOffset\(/);
    }
  });

  it('never writes 1/3 + 2/3 anywhere but inside shellOffset itself', () => {
    // The SHAPE of the shell, like its thickness, has exactly one author.
    // Comments are stripped first, because a comment that QUOTES the shape
    // to say what changed is documentation, while a second expression that
    // computes it is a second authority — and this plan asks its comments
    // to quote the old numbers on purpose.
    for (const f of FILES) {
      const code = codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8'));
      const hits = code.match(/1\s*\/\s*3\s*\+\s*\(?\s*2\s*\/\s*3/g) ?? [];
      expect(hits.length, `${f} computes the shell shape ${hits.length} times`).toBe(
        f === 'geoHelpers.ts' ? 1 : 0
      );
    }
  });

  it('leaves no absolute height above the surface in any layer', () => {
    // The shell was not the only geometry lifted off the ground by a
    // constant: routeArc.ts:37-40 had 0,018 / 0,012 / 0,055 and
    // continents.ts:24 had GLOBE_RADIUS * 1.003 — 19,1 km of apparent
    // altitude, taller than the whole corrected shell. Every height above
    // the surface is now either a FRACTION of the per-frame shell (D46) or
    // COASTLINE_LIFT (D47), and neither may be spelled as a literal here.
    //
    // 1\.00 and not 1\.0: atmosphere.ts draws its veil at GLOBE_RADIUS *
    // 1.04 and D39 forbids this plan from touching that file at all.
    // 0\.0\d and not 0\.\d: three layers set a bounding sphere at
    // GLOBE_RADIUS + 0.5, which is a cull radius and not an altitude.
    for (const f of FILES) {
      if (f === 'geoHelpers.ts') continue; // where both constants now live
      const code = codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8'));
      expect(code, f).not.toMatch(/GLOBE_RADIUS\s*\*\s*1\.00/);
      expect(code, f).not.toMatch(/GLOBE_RADIUS\s*\+\s*0\.0\d/);
    }
  });

  it('makes the route arc take its scale from the frame, not from itself', () => {
    const src = readFileSync(join(GLOBE_DIR, 'routeArc.ts'), 'utf8');
    expect(src).toMatch(/shellUnits/);
    // The three old constants are gone as offsets and survive only as
    // ratios, which is what keeps planet view bit-for-bit identical.
    expect(src).toMatch(/ARC_BASE_FRAC/);
    expect(src).not.toMatch(/ARC_BASE_OFFSET\s*=\s*0\.018/);
  });
});

/**
 * Where the camera opens is now part of the shell's law — SHELL_FULL_DISTANCE
 * is anchored to it — so a second opinion about it is a second opinion about
 * the planet view. It was a literal in mountScene and nothing could read it,
 * which is exactly how an identity came to be asserted at a distance the
 * user is never at on load (D48).
 */
describe('the distance the page opens at has exactly one authority', () => {
  it('leaves no numeric camera.position.set under src/globe', () => {
    const offenders = FILES.filter((f) =>
      /camera\.position\.set\(\s*-?\d/.test(codeOnly(readFileSync(join(GLOBE_DIR, f), 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it('and scene.ts reads the declaration instead', () => {
    expect(readFileSync(join(GLOBE_DIR, 'scene.ts'), 'utf8')).toContain(
      'camera.position.set(...CAMERA_MOUNT_POSITION)'
    );
  });
});
