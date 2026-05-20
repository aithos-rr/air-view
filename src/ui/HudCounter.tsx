import { useEffect, useRef, useState } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';

const ANNOUNCE_THRESHOLD = 100; // re-announce only on Δ > 100 (spec §13)

export function HudCounter() {
  const count = useAircraftStore((s) => s.aircraft.size);
  const status = useAircraftStore((s) => s.fetchStatus);
  const lastAnnounced = useRef(0);
  const [announceCount, setAnnounceCount] = useState(0);

  useEffect(() => {
    if (Math.abs(count - lastAnnounced.current) >= ANNOUNCE_THRESHOLD) {
      lastAnnounced.current = count;
      setAnnounceCount(count);
    }
  }, [count]);

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
    </div>
  );
}
