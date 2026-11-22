import { describe, it, expect, beforeEach } from 'vitest';
import { nextCoastline, useDetailStore } from '@/state/detailStore';
import type { CoastlineDetail } from '@/state/detailStore';

const ALL: CoastlineDetail[] = ['none', 'coarse', 'loading', 'fine', 'coarse-only'];

describe('the detail store says what the globe is actually drawing', () => {
  beforeEach(() => useDetailStore.setState({ coastline: 'none', cities: 'absent' }));

  it('starts at the only thing that is true before anything has loaded', () => {
    // Not 'coarse'. The outline is fetched, so the first frames are drawn
    // without it: starting at 'coarse' would be the store asserting a level
    // the screen has not got yet, which is the whole family of D15.
    expect(useDetailStore.getState().coastline).toBe('none');
    expect(useDetailStore.getState().cities).toBe('absent');
  });

  it('walks both endings: the one that arrives and the one that does not', () => {
    const s = () => useDetailStore.getState();
    s().setCoastline('coarse');
    s().setCoastline('loading');
    s().setCoastline('fine');
    expect(s().coastline).toBe('fine');

    useDetailStore.setState({ coastline: 'coarse' });
    s().setCoastline('loading');
    s().setCoastline('coarse-only');
    expect(s().coastline).toBe('coarse-only');
  });

  it('cannot reach fine from anywhere but loading', () => {
    // THE rule. 'fine' means the fine level is on screen, and the only road
    // to being on screen is fetched, decoded and built — which is what
    // 'loading' names. Any other way in would let a caller announce a level
    // nobody drew (D42), including the worst one: a fetch that failed, left
    // the state at 'coarse-only', and then declared success anyway.
    for (const from of ALL) {
      useDetailStore.setState({ coastline: from });
      useDetailStore.getState().setCoastline('fine');
      expect(useDetailStore.getState().coastline, `from ${from}`).toBe(
        from === 'loading' || from === 'fine' ? 'fine' : from
      );
    }
    expect(nextCoastline('coarse', 'fine')).toBe('coarse');
    expect(nextCoastline('coarse-only', 'fine')).toBe('coarse-only');
  });

  it('refuses an illegal move in place instead of throwing', () => {
    // These setters are called from a fetch handler and from inside the
    // render loop. An exception there takes the globe down over a
    // bookkeeping mistake, which is a worse answer than keeping the last
    // word that was true.
    useDetailStore.setState({ coastline: 'none' });
    expect(() => useDetailStore.getState().setCoastline('coarse-only')).not.toThrow();
    expect(useDetailStore.getState().coastline).toBe('none');
  });
});
