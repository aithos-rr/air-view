import type { Aircraft } from '@/types';
import { formatLocalTime } from '@/data/timezones';
import { routeEnds } from '@/data/airportInfo';
import type { AirportInfo } from '@/data/airportInfo';
import { arcVerdict } from '@/state/sceneView';
import type { ArcVerdict } from '@/state/sceneView';

interface FlightCardProps {
  aircraft: Aircraft;
  onClose: () => void;
}

export function FlightCard({ aircraft, onClose }: FlightCardProps) {
  const r = aircraft.resolved;
  const now = new Date();
  const originTime = r?.origin ? formatLocalTime(now, r.origin.timezone) : null;
  const destTime = r?.destination ? formatLocalTime(now, r.destination.timezone) : null;
  const ends = aircraft.route ? routeEnds(aircraft.route) : null;
  const lastSeen =
    aircraft.lastContact === null
      ? '—'
      : new Date(aircraft.lastContact * 1000).toISOString().slice(11, 19);

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

      {/* Decided on aircraft.route, the field the server fills from adsbdb,
          NOT on what lookupAirport() could find. 13 IATA codes of the route
          cache are missing from the bundled table and those flights used to
          read "Route unknown", which is false: the route is known, one of
          its airports has no coordinates here. */}
      {ends ? (
        <>
          <div className="route">
            {ends.origin.iata} → {ends.destination.iata}
          </div>
          {originTime && destTime && (
            <div className="times">
              {originTime} · {destTime}
            </div>
          )}
          <ArcNote origin={ends.origin} destination={ends.destination} />
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

/**
 * Why the globe draws no line between these two airports, in words.
 *
 * Asked of arcVerdict — the one function the renderer itself obeys — and
 * not of isPlaceable. isPlaceable answers a NARROWER question: 13 of the
 * 4 243 routes in the committed cache depart and arrive at the same
 * airport, both ends perfectly placeable, and for those this note stayed
 * silent while the globe drew nothing. The card said "CDG → CDG" and the
 * picture said nothing at all, with no word to join them (D15a).
 */
function ArcNote({ origin, destination }: { origin: AirportInfo; destination: AirportInfo }) {
  const verdict = arcVerdict(origin, destination);
  if (verdict.arc) return null;
  return <div className="route__note">{arcNoteText(verdict)}</div>;
}

function arcNoteText(verdict: Exclude<ArcVerdict, { arc: true }>): string {
  switch (verdict.why) {
    case 'unplaceable':
      return 'Airport position unknown — no arc drawn';
    case 'samePlace':
      return 'Departure and arrival are the same airport — no arc drawn';
    case 'antipodal':
      return 'Departure and arrival are exactly opposite on the globe — no arc drawn';
    default:
      // Coordinates we cannot measure a distance between. Nothing to say
      // about the airports, so the note claims nothing about them.
      return 'No arc drawn';
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className="field__value">{value}</dd>
    </div>
  );
}
