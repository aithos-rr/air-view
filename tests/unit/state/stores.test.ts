import { describe, it, expect, beforeEach } from 'vitest';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useA11yStore } from '@/state/a11yStore';

describe('aircraftStore', () => {
  beforeEach(() =>
    useAircraftStore.setState({ aircraft: new Map(), fetchedAt: 0, fetchStatus: 'idle' })
  );

  it('updateBatch replaces aircraft by icao24', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([
      {
        icao24: 'a1',
        callsign: 'BAW274',
        longitude: 0,
        latitude: 0,
        baroAltitudeFt: 38000,
        velocityKt: 473,
        headingDeg: 90,
        onGround: false,
        lastContact: 1,
      },
    ]);
    expect(useAircraftStore.getState().aircraft.size).toBe(1);
    expect(useAircraftStore.getState().aircraft.get('a1')?.callsign).toBe('BAW274');
  });

  it('updateBatch preserves trail history when updating existing aircraft', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([
      {
        icao24: 'a1',
        callsign: 'X',
        longitude: 0,
        latitude: 0,
        baroAltitudeFt: 38000,
        velocityKt: 473,
        headingDeg: 90,
        onGround: false,
        lastContact: 1,
      },
    ]);
    store.updateBatch([
      {
        icao24: 'a1',
        callsign: 'X',
        longitude: 1,
        latitude: 1,
        baroAltitudeFt: 38000,
        velocityKt: 473,
        headingDeg: 90,
        onGround: false,
        lastContact: 2,
      },
    ]);
    const ac = useAircraftStore.getState().aircraft.get('a1');
    expect(ac?.trail.length).toBeGreaterThanOrEqual(1);
  });

  it('removeStale drops aircraft not seen in N seconds', () => {
    const store = useAircraftStore.getState();
    store.updateBatch([
      {
        icao24: 'a1',
        callsign: 'X',
        longitude: 0,
        latitude: 0,
        baroAltitudeFt: 0,
        velocityKt: 0,
        headingDeg: 0,
        onGround: false,
        lastContact: 100,
      },
    ]);
    store.removeStale(150);
    expect(useAircraftStore.getState().aircraft.has('a1')).toBe(true);
    store.removeStale(300);
    expect(useAircraftStore.getState().aircraft.has('a1')).toBe(false);
  });
});

describe('selectionStore', () => {
  beforeEach(() => useSelectionStore.setState({ selectedIcao: null }));
  it('select sets selectedIcao', () => {
    useSelectionStore.getState().select('a1');
    expect(useSelectionStore.getState().selectedIcao).toBe('a1');
  });
  it('select(null) clears', () => {
    useSelectionStore.setState({ selectedIcao: 'a1' });
    useSelectionStore.getState().select(null);
    expect(useSelectionStore.getState().selectedIcao).toBeNull();
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
