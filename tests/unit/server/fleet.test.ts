import { describe, it, expect } from 'vitest';
import { createFleet } from '../../../server/fleet';
import type { AircraftRaw } from '../../../src/types';

function ac(icao: string, lastContact: number | null, lat = 10): AircraftRaw {
  return {
    icao24: icao, callsign: 'TST1', longitude: 10, latitude: lat,
    baroAltitudeFt: 30000, velocityKt: 400, headingDeg: 90, onGround: false,
    lastContact, registration: 'X', modelCode: 'A320', modelDesc: null,
    route: null, complete: false,
  };
}

describe('createFleet', () => {
  it('accumulates aircraft across tiles — no single tile holds the world', () => {
    const f = createFleet();
    f.absorb([ac('a', 100), ac('b', 100)], 100);
    f.absorb([ac('c', 101)], 101);
    expect(f.size()).toBe(3);
  });

  it('updates an aircraft seen again in another tile instead of duplicating it', () => {
    const f = createFleet();
    f.absorb([ac('a', 100, 10)], 100);
    f.absorb([ac('a', 150, 20)], 150);
    expect(f.size()).toBe(1);
    expect(f.snapshot()[0]!.latitude).toBe(20);
    expect(f.snapshot()[0]!.lastContact).toBe(150);
  });

  it('never replaces a fresher record with a staler one', () => {
    // Overlapping tiles can return the same aircraft with different ages.
    const f = createFleet();
    f.absorb([ac('a', 200, 20)], 200);
    f.absorb([ac('a', 100, 10)], 200);
    expect(f.snapshot()[0]!.lastContact).toBe(200);
    expect(f.snapshot()[0]!.latitude).toBe(20);
  });

  it('reports how many records a batch actually changed', () => {
    const f = createFleet();
    expect(f.absorb([ac('a', 100), ac('b', 100)], 100)).toBe(2);
    expect(f.absorb([ac('a', 100)], 100)).toBe(0); // same timestamp, no change
  });

  it('prunes aircraft no tile has reported within the age window', () => {
    // Ageing is on the moment WE absorbed a record, so two aircraft taken
    // in by the same batch always age together: 'old' has to arrive in an
    // earlier sweep or this asserts nothing.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('old', 1000)], 1000);
    f.absorb([ac('fresh', 1500)], 1500);
    const removed = f.prune(1700);
    expect(removed).toBe(1);
    expect(f.snapshot().map((a) => a.icao24)).toEqual(['fresh']);
  });

  it('keeps everything when nothing has aged out', () => {
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', 1000), ac('b', 1100)], 1100);
    expect(f.prune(1200)).toBe(0);
    expect(f.size()).toBe(2);
  });

  it('absorbs a record whose staleness the provider never stated', () => {
    // null is "the provider did not say how old this fix is", not "fresh":
    // an aircraft we cannot date is still an aircraft a tile reported.
    const f = createFleet();
    f.absorb([ac('a', null)], 100);
    expect(f.snapshot().map((x) => x.icao24)).toEqual(['a']);
    expect(f.snapshot()[0]!.lastContact).toBeNull();
  });

  it('prunes an undatable record too — it is not immortal', () => {
    // Ageing on lastContact would have to skip what it cannot compare, and
    // a record of unknown staleness would then never leave the fleet.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', null)], 1000);
    expect(f.prune(1500)).toBe(0);
    expect(f.prune(1700)).toBe(1);
    expect(f.size()).toBe(0);
  });

  it('lets the incoming record win whenever the two ages are not comparable', () => {
    // Either side unknown means no ordering exists, so the tie goes to the
    // batch we fetched last rather than to whatever is already in the map.
    const f = createFleet();
    f.absorb([ac('a', null, 10)], 100);
    expect(f.absorb([ac('a', 150, 20)], 150)).toBe(1);
    expect(f.snapshot()[0]!.lastContact).toBe(150);
    expect(f.snapshot()[0]!.latitude).toBe(20);

    f.absorb([ac('b', 150, 10)], 150);
    expect(f.absorb([ac('b', null, 30)], 200)).toBe(1);
    expect(f.snapshot().find((x) => x.icao24 === 'b')!.latitude).toBe(30);
  });

  it('ages on OUR clock, whatever clock the provider stamped the batch with', () => {
    // SourceResult.fetchedAt is NOT the instant of our fetch: both adapters
    // derive it from the upstream `now` field, so it is the provider's
    // clock, while prune() is called with ours. Ageing on it let the
    // provider's drift stretch or shrink the retention window in silence.
    // Nothing the provider says about time may move what prune() does: the
    // only clock that counts is the atUnix the poller passes in.
    const behind = createFleet({ maxAgeSeconds: 600 });
    const ahead = createFleet({ maxAgeSeconds: 600 });
    // Same aircraft, same local instant of absorption; only the ages the
    // provider claims differ — an hour behind, an hour ahead, unstated.
    behind.absorb([ac('a', 1000 - 3600), ac('b', null)], 1000);
    ahead.absorb([ac('a', 1000 + 3600), ac('b', null)], 1000);
    expect(behind.prune(1500)).toBe(0);
    expect(ahead.prune(1500)).toBe(0);
    expect(behind.prune(1601)).toBe(2);
    expect(ahead.prune(1601)).toBe(2);
    expect(behind.size()).toBe(0);
    expect(ahead.size()).toBe(0);
  });

  it('starts empty', () => {
    expect(createFleet().snapshot()).toEqual([]);
  });

  it('lets the retention window be retuned at runtime', () => {
    // A sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling of
    // one tile every 1.5 s, and that varies. A window shorter than a sweep
    // deletes aircraft long before their tile comes round again, leaving a
    // rotating smear instead of a fleet — so the poller derives it from the
    // sweep it actually observes.
    const f = createFleet({ maxAgeSeconds: 600 });
    f.absorb([ac('a', 1000)], 1000);
    f.setMaxAgeSeconds(3000);
    expect(f.maxAgeSeconds()).toBe(3000);
    expect(f.prune(3500)).toBe(0); // 2500s old, still inside the new window
    f.setMaxAgeSeconds(600);
    expect(f.prune(3500)).toBe(1);
  });

  it('caps the snapshot, keeping what we absorbed last', () => {
    // /api/states serves the WHOLE fleet on every request, so the payload is
    // as big as the retention window makes it. Dropping the oldest sightings
    // first drops exactly what prune() would take next.
    const f = createFleet();
    f.absorb([ac('old1', 100), ac('old2', 100)], 100);
    f.absorb([ac('new1', 200), ac('new2', 200)], 200);
    expect(
      f
        .snapshot(2)
        .map((a) => a.icao24)
        .sort()
    ).toEqual(['new1', 'new2']);
  });

  it('returns the whole fleet when it is under the cap', () => {
    const f = createFleet();
    f.absorb([ac('a', 100), ac('b', 100)], 100);
    expect(f.snapshot(50)).toHaveLength(2);
    expect(f.snapshot()).toHaveLength(2);
  });
});
