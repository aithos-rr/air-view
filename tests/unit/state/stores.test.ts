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
});

describe('selectionStore', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIcao: null, openEnd: null }));
  it('select sets selectedIcao', () => {
    useSelectionStore.getState().select('a1');
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
    useSelectionStore.getState().select('a2');
    expect(useSelectionStore.getState().openEnd).toBeNull();
  });
  it('shuts the airport card when focus ends', () => {
    useSelectionStore.setState({ selectedIcao: 'a1', openEnd: 'destination' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().openEnd).toBeNull();
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
