import { useEffect, useRef, useState } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';
import { useDetailStore } from '@/state/detailStore';

const ANNOUNCE_THRESHOLD = 100; // re-announce only on Δ > 100 (spec §13)
/**
 * Past this, say how old the data is.
 *
 * Every other warning the HUD shows is something the SERVER said — the stale
 * flag, the error status — and each can go missing: a CDN rewriting the body,
 * a rolled-back server, a request that never answers. The age of the batch in
 * hand is measured on the browser's own clock and needs nobody's cooperation.
 * Set above a normal refresh so an ordinary gap stays quiet.
 */
const STALE_AGE_SECONDS = 120;
const AGE_TICK_MS = 10_000;

export function FeedStatus() {
  const count = useAircraftStore((s) => s.aircraft.size);
  const status = useAircraftStore((s) => s.fetchStatus);
  const stale = useAircraftStore((s) => s.feedStale);
  const capped = useAircraftStore((s) => s.feedCapped);
  const feedFetchedAt = useAircraftStore((s) => s.feedFetchedAt);
  const coastline = useDetailStore((s) => s.coastline);
  const cities = useDetailStore((s) => s.cities);
  const lastAnnounced = useRef(0);
  const [announceCount, setAnnounceCount] = useState(0);

  // Re-rendered on a timer so the age keeps counting even when nothing
  // arrives — which is exactly the case this is here to make visible.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (Math.abs(count - lastAnnounced.current) >= ANNOUNCE_THRESHOLD) {
      lastAnnounced.current = count;
      setAnnounceCount(count);
    }
  }, [count]);

  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - feedFetchedAt);

  return (
    <div className="hud__feed" role="status" aria-live="polite" aria-atomic="true">
      {/* The visible number moved to the FleetPanel button, which is also
          the disclosure control: one number on screen, not two that can
          disagree. The screen-reader announcement stays here, because this
          is the live region and an announcement is not a label — and the
          .hud class went with the number, because the box is the panel now
          and two nested nodes with that class is one ambiguous selector.

          "in the feed", not "aircraft": this number is aircraft.size and
          it does not move when a filter, a focus or a missing coordinate
          takes aircraft off the globe. Announced bare it would say
          "5 900 aircraft" into the ear of someone looking at 200 — the
          family of D15 reaching the one user who cannot check the picture
          against the words. The panel's own live region (FleetPanel) is
          what announces how many are drawn and why. */}
      <span className="sr-only">{announceCount.toLocaleString()} aircraft in the feed</span>
      {status === 'error' && (
        <span className="hud__status" aria-label="Signal interrupted, retrying">
          {' '}
          · signal interrupted · retrying
        </span>
      )}
      {!stale && feedFetchedAt > 0 && ageSeconds >= STALE_AGE_SECONDS && (
        <span className="hud__status" aria-label={`Last update ${Math.floor(ageSeconds / 60)} minutes ago`}>
          {' '}
          · last update {Math.floor(ageSeconds / 60)} min ago
        </span>
      )}
      {capped && (
        <span className="hud__status" aria-label="Partial world, the server truncated the fleet">
          {' '}
          · partial world · server truncated the fleet
        </span>
      )}
      {stale && (
        <span className="hud__status" aria-label="Feed stale, showing last known positions">
          {' '}
          · feed stale · last known positions
        </span>
      )}
      {/* The cartography comes AFTER the feed: a stopped feed is the more
          urgent news, and this div is already aria-live="polite", so the
          reading order is the DOM order.

          Nothing is said about a level that IS there, nor about one on its
          way: a HUD that narrates its successes is a HUD nobody is still
          reading when it narrates a failure (D42). The aria-labels spell
          "1 to 50 million" because a screen reader reads "1:50 M" as
          "one two points fifty em". No CSS: .hud__status already exists,
          and "keep the same graphics" holds for the HUD too. */}
      {coastline === 'none' && (
        <span className="hud__status" aria-label="No coastline, the map data did not load">
          {' '}
          · no coastline · map data did not load
        </span>
      )}
      {coastline === 'coarse-only' && (
        <span
          className="hud__status"
          aria-label="Fine coastline unavailable, showing the 1 to 50 million outline"
        >
          {' '}
          · fine coastline unavailable · showing the 1:50 M outline
        </span>
      )}
      {cities === 'unavailable' && (
        <span className="hud__status" aria-label="City names unavailable">
          {' '}
          · city names unavailable
        </span>
      )}
    </div>
  );
}
