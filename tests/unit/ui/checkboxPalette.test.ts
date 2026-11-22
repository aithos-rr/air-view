import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPLETE_COLOR, PARTIAL_COLOR } from '@/globe/aircraft';

/**
 * Each box carries the colour of the aircraft it governs.
 *
 * The partial box used to be red. Red means error, and a partial aircraft is
 * not an error — it is one we know less about, because the free sources do
 * not carry everything. Measured in production the day this was decided,
 * 96.5% of the fleet was partial, so a red box painted almost the whole sky
 * as a problem. It also opened a fourth meaning in a palette that had kept
 * to three: Action Blue is selected, warm white is complete, grey is partial.
 *
 * The box being the aircraft makes the legend unnecessary — and this test
 * exists because two hand-typed copies of one colour are exactly the kind of
 * pair that drifts apart, which is the defect this project has met most.
 */
const rgb = (c: readonly [number, number, number]): string =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}`;

describe('the filter boxes wear the fleet colours', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
  const rule = (kind: string): string => {
    const i = css.indexOf(`.fleet__box[data-kind="${kind}"]`);
    expect(i, `no rule for ${kind}`).toBeGreaterThan(-1);
    return css.slice(i, i + 400);
  };

  it('paints the complete box the colour of a complete aircraft', () => {
    expect(rule('complete')).toContain(rgb(COMPLETE_COLOR));
  });

  it('paints the partial box the colour of a partial aircraft', () => {
    expect(rule('partial')).toContain(rgb(PARTIAL_COLOR));
  });

  it('keeps red out of the fleet palette entirely', () => {
    // Red carries "error" and no aircraft state is an error. If a warning
    // colour is ever wanted it belongs on an ACTION — "2 340 hidden by
    // filters" — not on a category of aircraft.
    expect(rule('partial')).not.toContain('255, 69, 58');
  });
});
