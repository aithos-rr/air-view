import { useEffect, useRef, useState } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';

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

export function HudCounter() {
  const count = useAircraftStore((s) => s.aircraft.size);
  const status = useAircraftStore((s) => s.fetchStatus);
  const stale = useAircraftStore((s) => s.feedStale);
  const capped = useAircraftStore((s) => s.feedCapped);
  const feedFetchedAt = useAircraftStore((s) => s.feedFetchedAt);
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
    <div className="hud" role="status" aria-live="polite" aria-atomic="true">
      <span aria-hidden="true">{count.toLocaleString()} aircraft</span>
      <span className="sr-only">{announceCount.toLocaleString()} aircraft</span>
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
    </div>
  );
}
