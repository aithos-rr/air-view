import { useMemo, useState, useRef, useEffect } from 'react';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';

interface AircraftListProps {
  onClose: () => void;
}

export function AircraftList({ onClose }: AircraftListProps) {
  const aircraft = useAircraftStore((s) => s.aircraft);
  const select = useSelectionStore((s) => s.select);
  const open = usePanelStore((s) => s.open);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    const arr = Array.from(aircraft.values())
      .filter((a) => a.callsign !== null)
      .sort((a, b) => (a.callsign ?? '').localeCompare(b.callsign ?? ''));
    if (!f) return arr;
    return arr.filter((a) => a.callsign?.includes(f));
  }, [aircraft, filter]);

  function handleSelect(icao: string): void {
    select(icao);
    open('flight');
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = listRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]');
      if (!rows || rows.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = Array.from(rows).findIndex((r) => r === active);
      const nextIdx =
        e.key === 'ArrowDown' ? (idx + 1) % rows.length : (idx - 1 + rows.length) % rows.length;
      rows[nextIdx]?.focus();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div id="aircraft-list">
      <header className="panel__header">
        <h2 className="panel__callsign">Aircraft ({aircraft.size.toLocaleString()})</h2>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <input
        className="list-filter"
        type="text"
        placeholder="Filter callsign…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter aircraft list"
      />

      <ul ref={listRef} role="listbox" aria-label="Aircraft" className="list">
        {filtered.slice(0, 50).map((a) => (
          <li
            key={a.icao24}
            role="option"
            tabIndex={0}
            aria-selected={false}
            onClick={() => handleSelect(a.icao24)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSelect(a.icao24);
            }}
            className="list-row"
          >
            <span className="list-row__callsign">{a.callsign}</span>
            <span className="list-row__alt">
              {a.baroAltitudeFt?.toLocaleString() ?? '—'} ft
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
