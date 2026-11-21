import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AirportCard } from '@/ui/AirportCard';
import type { AirportInfo } from '@/data/airportInfo';

const JFK: AirportInfo = {
  end: 'origin',
  iata: 'JFK',
  name: 'John F Kennedy International Airport',
  icao: 'KJFK',
  city: 'New York',
  lat: 40.6398,
  lon: -73.7789,
  terminal: null,
};

describe('AirportCard', () => {
  afterEach(cleanup);

  it('names the airport and says which end of the route it is', () => {
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    expect(screen.getByText(/John F Kennedy International Airport/)).toBeInTheDocument();
    expect(screen.getByText(/departure/i)).toBeInTheDocument();
  });

  it('shows both codes and the city when the table knows them', () => {
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    // Exact string, not /JFK/: that regex also matches the ICAO row's
    // KJFK, so it found two elements and failed on an ambiguity of its
    // own making rather than on anything the card does.
    expect(screen.getByText('JFK')).toBeInTheDocument();
    expect(screen.getByText(/KJFK/)).toBeInTheDocument();
    expect(screen.getByText(/New York/)).toBeInTheDocument();
  });

  it('omits what it does not know instead of printing a placeholder', () => {
    // One of the 13 IATA codes the bundled table is missing. A dash in the
    // ICAO row would read as "this airport has no ICAO code".
    const unknown: AirportInfo = {
      ...JFK, end: 'destination', iata: 'FRU', name: 'Manas International Airport',
      icao: null, city: null, lat: null, lon: null,
    };
    render(<AirportCard airport={unknown} onClose={() => {}} />);
    expect(screen.getByText(/Manas International Airport/)).toBeInTheDocument();
    expect(screen.queryByText(/ICAO/i)).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('does NOT render a terminal row when no terminal is known', () => {
    // This is the production case, every time: no free source exposes
    // terminals (spec §2). "Terminal —" would suggest one we do not have
    // and a number would be Aalborg->Aarhus in another costume.
    render(<AirportCard airport={JFK} onClose={() => {}} />);
    expect(screen.queryByText(/terminal/i)).toBeNull();
  });

  it('renders the terminal row when a terminal really is present', () => {
    // The branch is modelled and tested so it is ready, not dead. The spec
    // asks for exactly this: shown if present, never invented.
    render(<AirportCard airport={{ ...JFK, terminal: '4' }} onClose={() => {}} />);
    expect(screen.getByText(/terminal/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('calls back on close so the marker can drop its aria-expanded', () => {
    let closed = false;
    render(<AirportCard airport={JFK} onClose={() => { closed = true; }} />);
    screen.getByRole('button', { name: /close/i }).click();
    expect(closed).toBe(true);
  });
});
