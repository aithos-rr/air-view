import type { AirportInfo } from '@/data/airportInfo';

interface AirportCardProps {
  airport: AirportInfo;
  onClose: () => void;
}

const END_WORD = { origin: 'Departure', destination: 'Arrival' } as const;

/**
 * What a D or A marker knows about its airport.
 *
 * Every row is conditional, and a missing value removes its row rather than
 * printing a dash: "ICAO —" reads as "this airport has no ICAO code", which
 * is a claim we have not earned. Measured 2026-11-21: 13 IATA codes in the
 * route cache are absent from public/data/airports.json, so the no-codes
 * case is real and not defensive.
 *
 * The terminal row never renders in production — no free source exposes
 * terminals (spec §2) — and that is the correct outcome, not a gap.
 */
export function AirportCard({ airport, onClose }: AirportCardProps) {
  return (
    <section className="airport" aria-label={`${END_WORD[airport.end]} airport`}>
      <header className="panel__header">
        <div className="panel__title-block">
          <span className="airport__end">{END_WORD[airport.end]}</span>
          <h3 className="airport__name">{airport.name ?? airport.iata}</h3>
        </div>
        <button onClick={onClose} aria-label="Close airport">
          ✕
        </button>
      </header>
      <dl className="fields">
        <Row label="IATA" value={airport.iata} />
        {airport.icao !== null && <Row label="ICAO" value={airport.icao} />}
        {airport.city !== null && <Row label="City" value={airport.city} />}
        {airport.terminal !== null && <Row label="Terminal" value={airport.terminal} />}
      </dl>
      {airport.lat === null && (
        <p className="route__note">Airport position unknown — not placed on the globe</p>
      )}
      <div className="divider" />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className="field__value">{value}</dd>
    </div>
  );
}
