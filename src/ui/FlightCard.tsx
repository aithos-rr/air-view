import type { Aircraft } from '@/types';
import { formatLocalTime } from '@/data/timezones';

interface FlightCardProps {
  aircraft: Aircraft;
  onClose: () => void;
}

export function FlightCard({ aircraft, onClose }: FlightCardProps) {
  const r = aircraft.resolved;
  const now = new Date();
  const originTime = r?.origin ? formatLocalTime(now, r.origin.timezone) : null;
  const destTime = r?.destination ? formatLocalTime(now, r.destination.timezone) : null;
  const lastSeen = new Date(aircraft.lastContact * 1000).toISOString().slice(11, 19);

  return (
    <article aria-label="Flight detail">
      <header className="panel__header">
        <div className="panel__title-block">
          <h2 className="panel__callsign">{aircraft.callsign ?? '—'}</h2>
          {r && <span className="panel__operator">{r.airlineName}</span>}
        </div>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {r?.origin && r?.destination ? (
        <>
          <div className="route">
            {r.origin.iata} → {r.destination.iata}
          </div>
          <div className="times">
            {originTime} · {destTime}
          </div>
        </>
      ) : (
        <div className="route">Route unknown</div>
      )}

      <div className="divider" />

      <dl className="fields">
        <Field
          label="Altitude"
          value={
            aircraft.baroAltitudeFt !== null
              ? `${aircraft.baroAltitudeFt.toLocaleString()} ft`
              : '—'
          }
        />
        <Field
          label="Ground speed"
          value={aircraft.velocityKt !== null ? `${aircraft.velocityKt} kt` : '—'}
        />
        <Field
          label="Heading"
          value={aircraft.headingDeg !== null ? `${Math.round(aircraft.headingDeg)}°` : '—'}
        />
        <Field label="ICAO24" value={aircraft.icao24} />
      </dl>

      <footer className="panel__footer">Last seen {lastSeen} UTC</footer>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className="field__value">{value}</dd>
    </div>
  );
}
