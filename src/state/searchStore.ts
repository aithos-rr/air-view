import { create } from 'zustand';
import type { FlightRouteLite } from '@/types';
import { expandQuery } from '@/data/flightQuery';
import { fetchRoute } from '@/data/routeClient';
import { useAircraftStore } from './aircraftStore';
import { useSelectionStore } from './selectionStore';
import { usePanelStore } from './panelStore';
import { leaveFlight } from './flightFocus';

/**
 * The outcomes of spec §6.3 as shapes rather than a string plus optional
 * fields: a state that cannot represent "unknown flight with a route
 * attached" cannot show one.
 *
 * There are FIVE, not the three the spec listed. `unreachable` is the one
 * the spec did not think of, because it is not an outcome about the
 * flight: it is an outcome about us. Without it a 500, a timeout or a
 * stopped server all arrive as `unknown` and the screen says "No flight by
 * that number" about a flight nobody asked about — D15b, in its purest
 * form.
 *
 * `notChecked` is the same defect one step lower down, and the commoner
 * one: the server answers honestly that it has never asked adsbdb about
 * this callsign — with ~8 374 cached and ~920 added an hour, that is the
 * ORDINARY answer for a real flight number — and flattening it into
 * `unknown` prints the same unmeasured certainty.
 */
export type SearchOutcome =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'focused'; callsign: string }
  | { kind: 'offCoverage'; callsign: string; route: FlightRouteLite }
  | { kind: 'notChecked'; query: string; callsign: string }
  | { kind: 'unknown'; query: string }
  | { kind: 'unreachable'; query: string; detail: string };

/**
 * At most three requests per search. Measured on the bundled airline table:
 * the largest number of ICAO codes behind one IATA code is 3 (G3 — City
 * Connexion, Gol, Sky Express), so this truncates no honest query while
 * making a burst impossible.
 */
const MAX_CANDIDATES = 3;

interface SearchState {
  query: string;
  outcome: SearchOutcome;
  setQuery: (q: string) => void;
  clear: () => void;
  run: (input: string) => Promise<void>;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  outcome: { kind: 'idle' },

  setQuery: (query) => set({ query }),

  clear: () => {
    // Clearing the box undoes what the search did, including the focus it
    // may have entered: a globe focused on a flight whose name is no longer
    // written anywhere would be a state with no way back. The card goes
    // with it, because the card exists only for that flight — and all of
    // that is leaveFlight(), the single place this act is written (D15).
    leaveFlight();
    set({ query: '', outcome: { kind: 'idle' } });
  },

  run: async (input) => {
    const candidates = expandQuery(input).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) {
      set({ outcome: { kind: 'unknown', query: input } });
      return;
    }
    set({ outcome: { kind: 'searching' } });

    // Outcome 1: in the feed. The fleet decides which candidate was meant,
    // which is the only authority that can — 17 IATA codes are shared.
    const fleet = useAircraftStore.getState().aircraft;
    for (const callsign of candidates) {
      for (const ac of fleet.values()) {
        if (ac.callsign === callsign) {
          // 'search': the user typed a flight number and has no idea where
          // on the globe it is, so the camera brings it round (D34).
          useSelectionStore.getState().select(ac.icao24, 'search');
          // select() ALONE empties the sky around an aircraft and then
          // names nothing: no flight card, no callsign, no route. Every
          // other way of choosing an aircraft in this codebase pairs the
          // two — src/globe/scene.ts:92-94 for the click on the globe,
          // src/ui/AircraftList.tsx:26-29 for the list — and the search is
          // not allowed to be the one that differs. Task 9 asserts
          // .panel__callsign right after this very search.
          usePanelStore.getState().open('flight');
          set({ outcome: { kind: 'focused', callsign } });
          return;
        }
      }
    }

    // Outcome 2: not in the sky we can see, but known to us. Our server
    // answers from memory; it never asks adsbdb while a user waits.
    //
    // No `.catch(() => null)` here any more. That one expression turned
    // every outage into the sentence "No flight by that number": the store
    // claimed to have checked something it had not been able to ask about
    // (D15b). fetchRoute now NAMES its three answers and this loop keeps
    // them apart.
    let couldNotAsk: string | null = null;
    let notChecked: string | null = null;
    for (const callsign of candidates) {
      const answer = await fetchRoute(callsign);
      if (answer.status === 'known') {
        // Let go of any flight still in focus BEFORE promising an arc.
        // readFocusView draws the ghost route only while nothing is
        // selected, so a flight focused by an earlier click would swallow
        // the arc this outcome promises, and the line would read "position
        // unavailable" over somebody else's route (D15a).
        leaveFlight();
        set({ outcome: { kind: 'offCoverage', callsign, route: answer.route } });
        return;
      }
      if (answer.status === 'unreachable') couldNotAsk = answer.detail;
      if (answer.status === 'notChecked' && notChecked === null) notChecked = callsign;
    }

    // Outcomes 4 and 5 come BEFORE outcome 3, and that order is the whole
    // point: "we could not ask" and "nobody has asked yet" both outrank "it
    // does not exist", because one of them is a measurement and the others
    // are the absence of one. Among themselves, the total failure comes
    // first: a server that did not answer is a worse state to hide than a
    // lookup that is merely still owed.
    if (couldNotAsk !== null) {
      set({ outcome: { kind: 'unreachable', query: input, detail: couldNotAsk } });
      return;
    }

    // Outcome 5: the server has never asked adsbdb about this callsign and
    // has now queued it. Saying "No flight by that number" here would be a
    // statement about the world made out of our own backlog (D15b).
    if (notChecked !== null) {
      set({ outcome: { kind: 'notChecked', query: input, callsign: notChecked } });
      return;
    }

    // Outcome 3: every candidate came back with a measured "we asked adsbdb
    // and it has no route for this callsign".
    set({ outcome: { kind: 'unknown', query: input } });
  },
}));
