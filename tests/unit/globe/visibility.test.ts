import { describe, it, expect } from 'vitest';
import { isAircraftVisible, isFocusable, SHOW_ALL } from '@/globe/visibility';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('isAircraftVisible', () => {
  it('hides the greys when the partial box is off', () => {
    const rule = { showComplete: true, showPartial: false, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(true);
  });

  it('hides the completes when the complete box is off — the two are independent', () => {
    const rule = { showComplete: false, showPartial: true, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(true);
  });

  it('shows nothing at all when both boxes are off', () => {
    const rule = { showComplete: false, showPartial: false, focusedIcao: null };
    expect(isAircraftVisible(ac({ complete: true }), rule)).toBe(false);
    expect(isAircraftVisible(ac({ complete: false }), rule)).toBe(false);
  });

  it('under focus shows the focused aircraft and nothing else', () => {
    const rule = { showComplete: true, showPartial: true, focusedIcao: 'a1' };
    expect(isAircraftVisible(ac({ icao24: 'a1' }), rule)).toBe(true);
    expect(isAircraftVisible(ac({ icao24: 'a2' }), rule)).toBe(false);
  });

  it('lets focus OVERRIDE a filter that would have hidden the focused flight', () => {
    // The user switched the greys off, then searched for a grey flight. The
    // specific act wins over the category rule: the alternative is a search
    // that silently does nothing, which reads as a broken search box.
    const rule = { showComplete: true, showPartial: false, focusedIcao: 'a1' };
    expect(isAircraftVisible(ac({ icao24: 'a1', complete: false }), rule)).toBe(true);
  });

  it('SHOW_ALL hides nothing, whatever the aircraft is', () => {
    expect(isAircraftVisible(ac({ complete: false }), SHOW_ALL)).toBe(true);
    expect(isAircraftVisible(ac({ complete: true }), SHOW_ALL)).toBe(true);
  });
});

describe('isFocusable', () => {
  // Focus hides every OTHER aircraft, so it is a promise that the one left
  // is on the globe. Granting it to an aircraft nobody can place hides the
  // whole fleet and draws nobody: an empty globe with nothing on screen to
  // explain it — the v1 failure this plan builds three guards against.

  it('accepts an aircraft we know the position of', () => {
    expect(isFocusable(ac({ latitude: 50, longitude: -10 }))).toBe(true);
  });

  it('refuses one whose latitude the provider never sent', () => {
    // Not hypothetical: the adapters write null on purpose —
    // src/data/sources/adsbLol.ts:30-31 — and
    // tests/unit/data/sources/adsbLol.test.ts pins it in "maps every
    // missing optional field to null".
    expect(isFocusable(ac({ latitude: null, longitude: -10 }))).toBe(false);
  });

  it('refuses one whose longitude is missing', () => {
    expect(isFocusable(ac({ latitude: 50, longitude: null }))).toBe(false);
  });

  it('refuses one carrying neither coordinate', () => {
    expect(isFocusable(ac({ latitude: null, longitude: null }))).toBe(false);
  });
});
