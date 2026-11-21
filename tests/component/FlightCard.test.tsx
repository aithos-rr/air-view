import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlightCard } from '@/ui/FlightCard';
import { initAirports } from '@/data/airportLookup';
import { makeAircraftRaw } from '../helpers/aircraft';
import type { Aircraft } from '@/types';

const JFK = {
  iata: 'JFK', icao: 'KJFK', name: 'John F Kennedy International Airport',
  city: 'New York', country: 'US', lat: 40.639801, lon: -73.7789,
  timezone: 'America/New_York',
};
const MIA = {
  iata: 'MIA', icao: 'KMIA', name: 'Miami International Airport',
  city: 'Miami', country: 'US', lat: 25.79325, lon: -80.290556,
  timezone: 'America/New_York',
};

function ac(over: Partial<Aircraft> = {}): Aircraft {
  return { ...makeAircraftRaw(), trail: [], ...over };
}

describe('FlightCard', () => {
  beforeEach(() => initAirports([JFK, MIA]));
  afterEach(cleanup);

  it('shows the real route', () => {
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'MIA', destinationName: 'Miami',
        airlineName: 'American Airlines',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.getByText(/JFK\s*→\s*MIA/)).toBeInTheDocument();
  });

  it('still shows the route when the airport table does not know an endpoint', () => {
    // 13 IATA codes of the committed route cache are missing from
    // public/data/airports.json, touching 17 of 4 243 routes. Until now
    // those read "Route unknown", which is false: we know the route, we
    // just do not know where one of its ends is.
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'FRU', destinationName: 'Manas International Airport',
        airlineName: 'Somebody',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.getByText(/JFK\s*→\s*FRU/)).toBeInTheDocument();
    expect(screen.getByText(/airport position unknown/i)).toBeInTheDocument();
  });

  it('says why a flight that lands where it took off gets no arc', () => {
    // 13 of the 4 243 routes in the committed cache are in this state
    // (AFR43GZ CDG->CDG, EWG48J HAM->HAM, BOX570 LEJ->LEJ). Both ends are
    // placeable, so the "airport position unknown" note never fired: the
    // card said "JFK → JFK", the globe drew nothing, and nothing on screen
    // joined the two (D15a).
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'JFK', destinationName: 'Kennedy',
        airlineName: 'Somebody',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.getByText(/JFK\s*\u2192\s*JFK/)).toBeInTheDocument();
    expect(screen.getByText(/same airport/i)).toBeInTheDocument();
  });

  it('keeps quiet about the arc when there IS one', () => {
    const a = ac({
      route: {
        originIata: 'JFK', originName: 'Kennedy',
        destinationIata: 'MIA', destinationName: 'Miami',
        airlineName: 'American Airlines',
      },
      complete: true,
    });
    render(<FlightCard aircraft={a} onClose={() => {}} />);
    expect(screen.queryByText(/no arc drawn/i)).toBeNull();
  });

  it('says the route is unknown when there is genuinely none, and draws no arrow', () => {
    render(<FlightCard aircraft={ac({ route: null })} onClose={() => {}} />);
    expect(screen.getByText(/route unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });
});
