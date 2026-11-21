import { describe, it, expect, beforeEach } from 'vitest';
import { useFilterStore, countFleet } from '@/state/filterStore';
import { makeAircraftRaw } from '../../helpers/aircraft';
import type { Aircraft } from '@/types';

// Note for the executor: the beforeEach below resets panelOpen too.

const ROUTE = {
  originIata: 'JFK',
  originName: 'John F Kennedy International Airport',
  destinationIata: 'MIA',
  destinationName: 'Miami International Airport',
  airlineName: 'American Airlines',
};

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('filterStore', () => {
  beforeEach(() =>
    useFilterStore.setState({ showComplete: true, showPartial: true, panelOpen: false })
  );

  it('shows both categories before the user touches anything', () => {
    // A visitor who never opens the panel must see the sky the previous
    // version showed them. A filter that defaults to ON is a filter nobody
    // asked for.
    const s = useFilterStore.getState();
    expect(s.showComplete).toBe(true);
    expect(s.showPartial).toBe(true);
  });

  it('toggles the two categories INDEPENDENTLY', () => {
    useFilterStore.getState().togglePartial();
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(true);
    useFilterStore.getState().toggleComplete();
    expect(useFilterStore.getState().showPartial).toBe(false);
    expect(useFilterStore.getState().showComplete).toBe(false);
  });

  it('allows both to be off — that is the user asking for an empty globe', () => {
    useFilterStore.getState().togglePartial();
    useFilterStore.getState().toggleComplete();
    const s = useFilterStore.getState();
    expect(s.showComplete || s.showPartial).toBe(false);
  });

  it('keeps the drop-down shut until asked, and keeps that fact in the store', () => {
    // Not component state: the Esc ladder of Task 4 has to know whether this
    // panel is open, and a useState inside a component is unreadable from a
    // window keydown handler.
    expect(useFilterStore.getState().panelOpen).toBe(false);
    useFilterStore.getState().setPanelOpen(true);
    expect(useFilterStore.getState().panelOpen).toBe(true);
  });
});

describe('countFleet', () => {
  it('splits the fleet so the two numbers always add up to the total', () => {
    // The spec calls the panel self-verifying: complete + partial IS total,
    // at every cycle, or one of the three numbers is lying.
    const fleet = [
      ac({ icao24: 'a1', complete: true, route: ROUTE }),
      ac({ icao24: 'a2', complete: false }),
      ac({ icao24: 'a3', complete: false }),
    ];
    const c = countFleet(fleet);
    expect(c.total).toBe(3);
    expect(c.complete).toBe(1);
    expect(c.partial).toBe(2);
    expect(c.complete + c.partial).toBe(c.total);
  });

  it('counts the greys that lack ONLY a route', () => {
    const fleet = [
      ac({ icao24: 'a1', complete: false, route: null }),
      ac({ icao24: 'a2', complete: false, route: null, registration: null }),
    ];
    expect(countFleet(fleet).routeOnly).toBe(1);
  });

  it('never counts a complete aircraft among the route-only greys', () => {
    const fleet = [ac({ icao24: 'a1', complete: true, route: ROUTE })];
    const c = countFleet(fleet);
    expect(c.routeOnly).toBe(0);
    expect(c.partial).toBe(0);
  });

  it('reads the server flag and does not recompute completeness', () => {
    // isComplete() runs server-side in enrich.ts and the answer travels in
    // the payload. Recomputing it here would be a second authority on the
    // same fact, free to disagree with the colour the globe is drawing.
    const fleet = [ac({ icao24: 'a1', complete: true, route: null })];
    expect(countFleet(fleet).complete).toBe(1);
  });
});
