import { forwardRef } from 'react';
import { usePanelStore } from '@/state/panelStore';
import { useSelectionStore } from '@/state/selectionStore';
import { useAircraftStore } from '@/state/aircraftStore';
import { FlightCard } from './FlightCard';
import { AirportCard } from './AirportCard';
import { readOpenAirport } from '@/state/sceneView';
import { AircraftList } from './AircraftList';
import { leaveFlight } from '@/state/flightFocus';

export const SidePanel = forwardRef<HTMLDivElement>(function SidePanel(_props, ref) {
  const mode = usePanelStore((s) => s.mode);
  const close = usePanelStore((s) => s.close);
  const selectedIcao = useSelectionStore((s) => s.selectedIcao);
  const aircraft = useAircraftStore((s) => s.aircraft);

  const selectedAircraft = selectedIcao ? aircraft.get(selectedIcao) ?? null : null;
  const openEnd = useSelectionStore((s) => s.openEnd);
  const openAirportEnd = useSelectionStore((s) => s.openAirport);
  // Read on render, not subscribed: `aircraft` and `openEnd` above are
  // already subscriptions, so every change that could alter this answer
  // re-renders the component anyway.
  const openAirport = openEnd !== null ? readOpenAirport() : null;

  return (
    <aside ref={ref} className="panel" data-mode={mode} aria-label="Aircraft information">
      {/* leaveFlight, not close: the panel's close() sets mode to 'closed'
          and says nothing about the selection, so the ✕ used to dismiss the
          card while the focus stayed on — globe still drawing 1 aircraft of
          5 900, and the explanation gone with the card (D15). The ✕, Escape
          and the search box's clear button are the same act and now call
          the same function. */}
      {/* The airport card sits above the flight, inside the panel that the
          leader line already points at, rather than in a popover that would
          have to dodge the very marker it belongs to and stay reachable
          with a keyboard.
          Its ✕ closes the airport only — it is a card INSIDE the focus, not
          the focus — which is why it calls openAirportEnd(null) and not
          leaveFlight(). Escape walks out in the same order. */}
      {mode === 'flight' && openAirport && (
        <AirportCard airport={openAirport} onClose={() => openAirportEnd(null)} />
      )}
      {mode === 'flight' && selectedAircraft && (
        <FlightCard aircraft={selectedAircraft} onClose={leaveFlight} />
      )}
      {/* In the fleet, but nobody knows where. latitude and longitude are
          null whenever the provider sent no position — the adapters write
          null on purpose (src/data/sources/adsbLol.ts:30-31) — and
          AircraftList offers every aircraft that has a callsign, position
          or not. readVisibilityRule refuses focus to such an aircraft
          (D13), so the globe does not change at all when it is chosen:
          without this line the user has picked a flight, seen nothing
          happen, and has nowhere to read why. It sits under the card
          rather than inside it because it is the PANEL speaking about the
          globe, which is the same job the Contact lost branch does. */}
      {mode === 'flight' &&
        selectedAircraft !== null &&
        (selectedAircraft.latitude === null || selectedAircraft.longitude === null) && (
          <p className="panel__note">Position unknown — not shown on the globe</p>
        )}
      {/* Selected, but the payload no longer carries it. The server prunes
          the fleet every cycle, so this arrives by waiting. Without this
          branch the panel renders NOTHING — no card, no toggle — next to a
          globe that has just refilled, and the screen changes with nobody
          saying why (D13). */}
      {mode === 'flight' && selectedIcao !== null && selectedAircraft === null && (
        <LostContact icao24={selectedIcao} onClose={leaveFlight} />
      )}
      {mode === 'list' && <AircraftList onClose={close} />}
      {/* 'flight' with nothing selected has no card to show, so it shows
          the way back in instead. This panel never renders an empty box. */}
      {(mode === 'closed' || (mode === 'flight' && selectedIcao === null)) && <PanelToggle />}
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

interface LostContactProps {
  icao24: string;
  onClose: () => void;
}

/**
 * The flight left the feed while the user was looking at it.
 *
 * The record is gone and the callsign went with it: the one identifier
 * still in hand is the ICAO24 address that the click produced, so that is
 * what this shows. Nothing is reconstructed from memory and nothing is
 * estimated. The card exists to say that the screen changed and why — the
 * globe has already refilled by the time it appears (D13) — not to keep a
 * picture alive that we can no longer vouch for.
 */
function LostContact({ icao24, onClose }: LostContactProps) {
  return (
    <article aria-label="Contact lost">
      <header className="panel__header">
        <div className="panel__title-block">
          <h2 className="panel__callsign">Contact lost</h2>
          <span className="panel__operator">{icao24.toUpperCase()}</span>
        </div>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="route">No longer in the feed</div>
      <p className="panel__footer">
        The server prunes the fleet every cycle: this flight has landed, left
        ADS-B coverage, or stopped being reported. Everything else is on the
        globe again.
      </p>
    </article>
  );
}
