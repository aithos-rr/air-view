import { describe, it, expect, beforeEach } from 'vitest';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useA11yStore } from '@/state/a11yStore';
import { makeAircraftRaw } from '../../helpers/aircraft';

describe('aircraftStore', () => {
  beforeEach(() =>
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStampMs: 0,
      feedStale: false,
      fetchStatus: 'idle',
    })
  );

  it('updateBatch replaces aircraft by icao24', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', callsign: 'BAW274', lastContact: 1 })], 1, false);
    expect(useAircraftStore.getState().aircraft.size).toBe(1);
    expect(useAircraftStore.getState().aircraft.get('a1')?.callsign).toBe('BAW274');
  });

  it('updateBatch preserves trail history when updating existing aircraft', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 0, latitude: 0, lastContact: 1 })], 1, false);
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 1, latitude: 1, lastContact: 2 })], 2, false);
    expect(useAircraftStore.getState().aircraft.get('a1')?.trail.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves a position with no lastContact out of the trail', () => {
    // An adapter leaves lastContact null when the provider did not report how
    // stale the fix is. A point nobody timestamped cannot be ordered against
    // the others, and a trail point has no room for a null t.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 0, latitude: 0, lastContact: null })], 1, false);
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', longitude: 1, latitude: 1, lastContact: 2 })], 2, false);
    expect(useAircraftStore.getState().aircraft.get('a1')?.trail).toEqual([]);
  });

  it('KEEPS an aircraft whose last fix is older than a full sweep', () => {
    // A full sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling
    // of one tile every 1.5 s, and the server sizes its retention on that, so
    // a fix 1200 s old is ordinary rather than exceptional. A client-side
    // window of 120 s would delete most of the fleet the server just sent —
    // the v1 empty globe all over again, in a milder form.
    const store = useAircraftStore.getState();
    const batchAt = 1_716_163_200;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'old', lastContact: batchAt - 1_200 })],
      batchAt,
      false
    );
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('keeps the whole fleet even when the batch itself is ancient', () => {
    // The v1 bug: a frozen feed made now - lastContact enormous for ALL
    // aircraft, so the client deleted the entire fleet.
    const store = useAircraftStore.getState();
    const batchAt = 1_000_000;
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a', lastContact: batchAt }), makeAircraftRaw({ icao24: 'b', lastContact: batchAt - 10 })],
      batchAt,
      false
    );
    expect(useAircraftStore.getState().aircraft.size).toBe(2);
  });

  it('drops an aircraft the server no longer reports — the server prunes, not us', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' }), makeAircraftRaw({ icao24: 'gone' })], 100, false);
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 160, false);
    const ids = [...useAircraftStore.getState().aircraft.keys()];
    expect(ids).toEqual(['a']);
  });

  it('reports the feed age from the batch timestamp', () => {
    const store = useAircraftStore.getState();
    const batchAt = Math.floor(Date.now() / 1000) - 45;
    store.updateBatch([makeAircraftRaw({ icao24: 'a', lastContact: batchAt })], batchAt, false);
    expect(useAircraftStore.getState().feedAgeSeconds()).toBeGreaterThanOrEqual(45);
  });

  it('keeps the stale flag the server put in the payload', () => {
    // The server moved this flag into the body because fetchStates reads only
    // res.json(). If the store drops it on the floor, the move bought nothing
    // and the guard against a silent outage is still missing.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 100, true);
    expect(useAircraftStore.getState().feedStale).toBe(true);
  });

  it('clears the stale flag as soon as a fresh batch arrives', () => {
    // A warning that cannot switch itself off is a warning nobody reads.
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 100, true);
    store.updateBatch([makeAircraftRaw({ icao24: 'a' })], 160, false);
    expect(useAircraftStore.getState().feedStale).toBe(false);
  });

  /** The server's instant for a batch that has just been built. */
  const NOW = () => Math.floor(Date.now() / 1000);

  it('gives every placeable record a motion, and none to the ones with no position', () => {
    // The whole plan hangs on this: the render loop reads ac.motion and
    // never recomputes it, because recomputing it per frame is 1,7 million
    // transcendental calls a second (D20).
    const at = NOW();
    const store = useAircraftStore.getState();
    store.updateBatch(
      [
        makeAircraftRaw({ icao24: 'a1', latitude: 50, longitude: -10, lastContact: at - 60 }),
        makeAircraftRaw({ icao24: 'a2', latitude: null, lastContact: at - 60 }),
      ],
      at,
      false
    );
    const fleet = useAircraftStore.getState().aircraft;
    expect(fleet.get('a1')?.motion?.extrapolable).toBe(true);
    expect(fleet.get('a1')?.motion?.fixAgeAtBatchS).toBe(60);
    expect(fleet.get('a2')?.motion ?? null).toBeNull();
  });

  it('stamps the batch on a monotonic clock, not on the wall one', () => {
    // feedFetchedAt is a wall INSTANT and stays one; feedStampMs is the
    // origin of every DURATION measured afterwards. Date.now() moves by
    // ~528 ms every ~32 s on this machine, which over a 30 s refresh is a
    // 1,8% error on every age in the fleet (D21).
    const at = NOW();
    const before = performance.now();
    useAircraftStore.getState().updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, false);
    const s = useAircraftStore.getState();
    expect(s.feedFetchedAt).toBe(at);
    // A body built this second is set back by at most the one second
    // Math.floor can cost; it is never stamped in the future.
    expect(s.feedStampMs).toBeGreaterThan(before - 1_500);
    expect(s.feedStampMs).toBeLessThanOrEqual(performance.now());
  });

  it('keeps the clock running while the server serves the same body again', () => {
    // The exact case the 120 s ceiling exists for, and the one case it
    // could never see. The server stamps fetchedAt when it BUILDS the body
    // and feedState.get() then hands that SAME body out for up to
    // maxStaleMs = 600 s (server/feedState.ts). A client that re-stamped
    // its monotonic clock on every arrival reset the age every 30 s, so
    // the aircraft went on extrapolating for eight and a half minutes
    // under a HUD that already said "feed stale · last known positions".
    // An age must grow with the time that really passed (D31).
    //
    // Two bodies cannot share a fetchedAt: a cycle is 8 tiles at the 1,5 s
    // floor plus TILE_CYCLE_GAP_MS (poller.ts:31, index.ts:185,621-631),
    // so at least 11 s apart, and fetchedAt has one-second resolution.
    const at = NOW();
    const store = useAircraftStore.getState();
    store.updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, false);
    const firstStamp = useAircraftStore.getState().feedStampMs;
    const firstFleet = useAircraftStore.getState().aircraft;

    store.updateBatch([makeAircraftRaw({ icao24: 'a1' })], at, true);
    const after = useAircraftStore.getState();
    expect(after.feedStampMs).toBe(firstStamp);
    // The same photograph carries no new measurement, so nothing is
    // re-derived — 11 625 records of six trig calls each, saved.
    expect(after.aircraft).toBe(firstFleet);
    // What DID arrive is the only thing that had changed.
    expect(after.feedStale).toBe(true);
  });

  it('sets the stamp back by the age the body already had when it arrived', () => {
    // fetchedAt is when the SERVER built the body, not when we received
    // it, and the two differ by a poller cycle in health and by minutes
    // during an outage — including on a first load, where there is no
    // previous batch for the rule above to protect. One subtraction
    // between two wall clocks, frozen, and it is the very quantity
    // feedAgeSeconds() prints in the HUD: the words and the movement now
    // come from one number (D21/D31).
    const before = performance.now();
    useAircraftStore.getState().updateBatch([makeAircraftRaw({ icao24: 'a1' })], NOW() - 45, false);
    const stamp = useAircraftStore.getState().feedStampMs;
    expect(before - stamp).toBeGreaterThan(44_000);
    expect(before - stamp).toBeLessThan(47_000);
  });

  it('hands the new motion the error the previous one had accumulated', () => {
    // A tile coming back must not teleport an aircraft by the few miles our
    // own extrapolation had drifted (D22).
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 60, longitude: -9.8 })],
      at + 60,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBeGreaterThan(0);
  });

  it('does not slide an aircraft that has been away for a quarter of an hour', () => {
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 900, longitude: 3 })],
      at + 900,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBe(0);
  });

  it('snaps instead of sliding when the viewer asked for less motion', () => {
    useA11yStore.setState({ prefersReducedMotion: true });
    const at = NOW();
    const store = useAircraftStore.getState();
    const base = { latitude: 50, longitude: -10, velocityKt: 450, headingDeg: 90 };
    store.updateBatch([makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at })], at, false);
    store.updateBatch(
      [makeAircraftRaw({ icao24: 'a1', ...base, lastContact: at + 60, longitude: -9.8 })],
      at + 60,
      false
    );
    expect(useAircraftStore.getState().aircraft.get('a1')?.motion?.offUntilMs).toBe(0);
    useA11yStore.setState({ prefersReducedMotion: false });
  });
});

describe('selectionStore', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIcao: null, openEnd: null }));
  it('select sets selectedIcao', () => {
    useSelectionStore.getState().select('a1', 'globe');
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });
  it('select(null) clears', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
  });
  it('opens one end of the route at a time', () => {
    useSelectionStore.getState().openAirport('origin');
    expect(useSelectionStore.getState().openEnd).toBe('origin');
    useSelectionStore.getState().openAirport('destination');
    expect(useSelectionStore.getState().openEnd).toBe('destination');
  });
  it('shuts the airport card when a different flight is selected', () => {
    // Otherwise the card for LHR stays on screen over the next flight's
    // route, labelled with an airport that has nothing to do with it.
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'origin' });
    useSelectionStore.getState().select('a2', 'globe');
    expect(useSelectionStore.getState().openEnd).toBeNull();
  });
  it('shuts the airport card when focus ends', () => {
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'destination' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().openEnd).toBeNull();
  });


  it('forgets that the previous flight was behind the globe when another is picked', () => {
    // A claim about where an aircraft is, left standing over a different
    // aircraft, is a claim nobody measured — and the render loop would
    // only correct it on the next frame, after the panel had already
    // printed it (D15b/D32).
    useSelectionStore.getState().select('a1', 'globe');
    useSelectionStore.getState().setFocusSightline('hidden');
    useSelectionStore.getState().select('a2', 'globe');
    expect(useSelectionStore.getState().focusSightline).toBe('in-sight');
  });

  it('forgets a flight that was on its way into view, too', () => {
    // The same rule for the third state: a rotation towards the previous
    // flight is cancelled by the new focus (scene.ts), so "turning to
    // bring it round" over the next one would describe a journey nobody
    // is making.
    useSelectionStore.getState().select('a1', 'search');
    useSelectionStore.getState().setFocusSightline('arriving');
    useSelectionStore.getState().select('a2', 'search');
    expect(useSelectionStore.getState().focusSightline).toBe('in-sight');
  });
});

describe('panelStore', () => {
  beforeEach(() => usePanelStore.setState({ mode: 'closed' }));
  it('open(flight) sets flight mode', () => {
    usePanelStore.getState().open('flight');
    expect(usePanelStore.getState().mode).toBe('flight');
  });
  it('open(list) sets list mode', () => {
    usePanelStore.getState().open('list');
    expect(usePanelStore.getState().mode).toBe('list');
  });
  it('close sets closed', () => {
    usePanelStore.setState({ mode: 'list' });
    usePanelStore.getState().close();
    expect(usePanelStore.getState().mode).toBe('closed');
  });
});

describe('a11yStore', () => {
  it('exposes prefersReducedMotion + keyboardMode booleans', () => {
    const s = useA11yStore.getState();
    expect(typeof s.prefersReducedMotion).toBe('boolean');
    expect(typeof s.keyboardMode).toBe('boolean');
  });
});
