import { forwardRef, useEffect } from 'react';
import { usePanelStore } from '@/state/panelStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useAircraftStore } from '@/state/aircraftStore';
import { FlightCard } from './FlightCard';
import { AircraftList } from './AircraftList';

export const SidePanel = forwardRef<HTMLDivElement>(function SidePanel(_props, ref) {
  const mode = usePanelStore((s) => s.mode);
  const close = usePanelStore((s) => s.close);
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);
  const aircraft = useAircraftStore((s) => s.aircraft);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const selectedAircraft = selectedIcao ? aircraft.get(selectedIcao) ?? null : null;

  return (
    <aside ref={ref} className="panel" data-mode={mode} aria-label="Aircraft information">
      {mode === 'flight' && selectedAircraft && (
        <FlightCard aircraft={selectedAircraft} onClose={close} />
      )}
      {mode === 'list' && <AircraftList onClose={close} />}
      {mode === 'closed' && <PanelToggle />}
    </aside>
  );
});

function PanelToggle() {
  const open = usePanelStore((s) => s.open);
  return (
    <header className="panel__header">
      <button className="panel__toggle" onClick={() => open('list')} aria-label="Open aircraft list">
        Aircraft
      </button>
    </header>
  );
}
