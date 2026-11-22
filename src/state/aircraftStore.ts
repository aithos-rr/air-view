import { create } from 'zustand';
import type { Aircraft, AircraftRaw, FetchStatus } from '@/types';
import { deriveMotion, reconcile } from '@/globe/deadReckoning';
import { useA11yStore } from './a11yStore';

const TRAIL_MAX = 30;

interface AircraftState {
  aircraft: Map<string, Aircraft>;
  /** Unix seconds of the batch currently held — NOT the local clock. */
  feedFetchedAt: number;
  /**
   * When the batch in hand was BUILT, on this browser's MONOTONIC clock.
   *
   * feedFetchedAt above is a wall INSTANT and stays one — it is what the
   * provider and our server agreed the fix ages are measured against. This
   * is the origin of every DURATION measured afterwards: the render loop
   * subtracts it from the rAF timestamp, and the two can be subtracted
   * because rAF timestamps and performance.now() share performance
   * .timeOrigin by specification. Date.now() moves by ~528 ms every ~32 s
   * on this machine (server/routeResolver.ts:47-58), and a wall clock is
   * not a stopwatch (D21).
   *
   * BUILT, not received, and the distinction is the whole of D31. The
   * server stamps fetchedAt when it assembles the body and then serves
   * that body unchanged while it is younger than maxStaleMs = 600 s
   * (server/feedState.ts), so this is set BACK by the age the body already
   * had on arrival, and a body we have already seen does not re-stamp it
   * at all. Counted from the arrival instead, the age of every fix reset
   * every 30 s and the fleet kept extrapolating for eight and a half
   * minutes while the HUD said "feed stale · last known positions".
   */
  feedStampMs: number;
  /**
   * What the SERVER said about the batch currently held: true means it was
   * served from cache past its freshness window. The client shows it rather
   * than acting on it — see the HUD. The v1 outage stayed invisible for 25
   * days because no layer ever said the feed had stopped.
   */
  feedStale: boolean;
  /** The server truncated the world it served, and said so. */
  feedCapped: boolean;
  fetchStatus: FetchStatus;
  setFetchStatus: (s: FetchStatus) => void;
  /** Replaces the fleet with what the server reports, preserving trails. */
  updateBatch: (
    raws: AircraftRaw[],
    batchFetchedAtUnix: number,
    stale: boolean,
    capped?: boolean
  ) => void;
  feedAgeSeconds: () => number;
}

export const useAircraftStore = create<AircraftState>((set, get) => ({
  aircraft: new Map(),
  feedFetchedAt: 0,
  feedStampMs: 0,
  feedStale: false,
  feedCapped: false,
  fetchStatus: 'idle',

  setFetchStatus: (s) => set({ fetchStatus: s }),

  /**
   * The payload IS the world: the server assembles it from tiles and prunes
   * it on its own schedule. The client mirrors that instead of applying a
   * second, independent staleness rule.
   *
   * v1 compared lastContact against the LOCAL clock, so a frozen feed made
   * every aircraft look infinitely stale and the whole fleet was deleted —
   * the last link in the chain that emptied the globe. Measuring against the
   * batch timestamp would have been better but still wrong here: a full
   * sweep takes 820-1000 s — 14-17 minutes — at the poller's ceiling of one
   * tile every 1.5 s and the server sizes its own retention on that observed
   * period, so any short client window would delete most of a legitimately
   * assembled fleet.
   */
  // `stale` has NO default on purpose: a missing argument used to quietly
  // clear a stale flag that was already raised. An unknown freshness is not
  // freshness, the same rule this project applies to routes and timestamps.
  updateBatch: (raws, batchFetchedAtUnix, stale, capped = false) =>
    set((state) => {
      // One reading of the monotonic clock for the whole batch: the records
      // all land in the same instant, and taking it per aircraft would make
      // 11 625 slightly different "now"s out of one event.
      const nowMs = performance.now();

      // How old the body ALREADY WAS when it reached us. ONE subtraction
      // between two wall clocks — the server's fetchedAt and this
      // browser's — taken once and then frozen, exactly as the fix ages
      // are (D21). It is the same quantity feedAgeSeconds() prints in the
      // HUD, which is the point: the sentence on screen and the distance
      // the dot travels now come out of one number and cannot contradict
      // each other.
      //
      // Floored at zero, and the floor is the safe direction: a browser
      // clock running behind makes this term vanish and leaves the rule
      // below to carry the age forward, while a clock running ahead stops
      // the extrapolation early. Neither can make us draw motion we have
      // not measured.
      const bodyAgeS = Math.max(0, Math.floor(Date.now() / 1000) - batchFetchedAtUnix);

      // The same photograph, served again. feedState.get() hands out one
      // body for up to maxStaleMs = 600 s while the poller is down, and
      // every arrival carries the same fetchedAt. Re-stamping the clock
      // here reset an age the real world was still adding to — the feed
      // stopped, the HUD said so, and the aircraft went on gliding for
      // eight and a half minutes (D31). Nothing is re-derived either:
      // there is no new measurement, and 11 625 records of six trig calls
      // apiece is not free.
      //
      // Two bodies cannot share a fetchedAt. A cycle is 8 tiles at the
      // 1,5 s floor plus TILE_CYCLE_GAP_MS (server/poller.ts:31,
      // server/index.ts:185,621-631), so they are at least 11 s apart and
      // fetchedAt has one-second resolution.
      if (state.feedFetchedAt !== 0 && batchFetchedAtUnix === state.feedFetchedAt) {
        return { feedStale: stale, feedCapped: capped };
      }

      const next = new Map<string, Aircraft>();
      const feedStampMs = nowMs - bodyAgeS * 1000;
      const elapsedOnPreviousS =
        state.feedStampMs === 0 ? 0 : (nowMs - state.feedStampMs) / 1000;
      // Read, not subscribed: this runs outside React, once per cycle.
      const animate = !useA11yStore.getState().prefersReducedMotion;

      for (const r of raws) {
        const prev = state.aircraft.get(r.icao24);
        const trail = prev?.trail ? [...prev.trail] : [];
        // Only real received positions enter the trail — never computed ones.
        if (prev && prev.longitude !== null && prev.latitude !== null && prev.lastContact !== r.lastContact) {
          // lastContact is null when the provider did not say how stale the fix
          // is, and the comparison above does not rule that out: both sides are
          // nullable. A point we cannot timestamp cannot be ordered in the trail.
          if (prev.lastContact !== null) {
            trail.push({ lon: prev.longitude, lat: prev.latitude, t: prev.lastContact });
          }
          if (trail.length > TRAIL_MAX) trail.shift();
        }
        // The expensive half of the dead reckoning, paid once every 30 s
        // instead of 60 times a second (D20). Six trig calls here are 2,4 ms
        // for the whole fleet; the same work per frame would be 1,7 million
        // transcendental calls a second.
        const fresh = deriveMotion(r, batchFetchedAtUnix);
        // bodyAgeS, not 0: this batch has already been running for as long
        // as the body was old when it arrived, and the correction has to be
        // measured against where the dot will actually be DRAWN (D31).
        const motion =
          fresh === null
            ? null
            : reconcile(fresh, bodyAgeS, prev?.motion ?? null, elapsedOnPreviousS, nowMs, animate);
        next.set(r.icao24, { ...r, trail, motion });
      }
      // Aircraft absent from the payload are gone: the server already pruned.
      return {
        aircraft: next,
        feedFetchedAt: batchFetchedAtUnix,
        feedStampMs,
        feedStale: stale,
        feedCapped: capped,
      };
    }),

  feedAgeSeconds: () => {
    const at = get().feedFetchedAt;
    if (at === 0) return 0;
    return Math.max(0, Math.floor(Date.now() / 1000) - at);
  },
}));
