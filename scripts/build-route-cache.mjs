// Builds server/data/route-cache.json by asking adsbdb about the callsigns
// seen in the live feed. Runs for hours on purpose: adsbdb rate-limits hard
// (~1190 lookups at 4.8 req/s earned a 300 s ban, and requests sent during
// the penalty renew it). Resumable in BOTH halves: the answers already
// collected AND the position in the 546-tile sampling rotation are read
// back from the same cache file, so a resumed run asks about new callsigns
// and samples new tiles. Resuming is the normal way to use this script.
//
// Runs under tsx, never under bare node: the sampler imports the server's
// tile grid, which is TypeScript, and node on its own answers
// ERR_MODULE_NOT_FOUND to a .js specifier that resolves to a .ts.
//
//   npm run build:routes                 # default: 4 hours, 240 of 546 tiles
//   npm run build:routes -- --hours 10   # one pass over the whole grid
//
// It REFUSES to start while the dev server is up or another build holds the
// lock (server/providerLock.ts): two uncoordinated streams against the same
// two providers is what got this machine banned, and the 360 s silence after
// a refusal is per process, not per machine.
//
// Four hours is 12 sampling rounds of 20 tiles, one round per ~20.7 min.
// All 546 tiles take 28 rounds, ~9.3 h — so either run it for 10 h or run
// it again: the grid cursor is saved in the cache file and the next run
// continues from it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildTileGrid, TILE_RADIUS_NM } from '../src/data/sources/tileGrid.js';
// Both imported, not written here: this file is a top-level program and
// nothing inside it can be reached by a test. What it keeps is the loop; what
// decides whether the run may start at all, and what an adsbdb answer means,
// lives in two modules the suite can mutate.
import { acquireProviderLock } from '../server/providerLock.js';
import {
  classifyLookupStatus,
  nextDelayAfterBlock,
  shouldAbortRun,
  BLOCK_SILENCE_MS,
} from '../server/lookupPolicy.js';

const UA = 'air-view/2.0 (+https://air-view-production.up.railway.app)';
const OUT = 'server/data/route-cache.json';
const CALLSIGN_RX = /^[A-Z]{3}[A-Z0-9]+$/;
/**
 * MONOTONIC clock. Every DURATION in this file is measured on it: the run
 * deadline and the 20-minute sampling gate.
 *
 * Date.now() on this machine moves by ~528 ms every ~32 s as WSL2 resyncs
 * against the host, and NTP corrects in both directions. A forward jump
 * would make the gate come due early and start a sampling round sooner than
 * the declared spacing; a backward jump would push the run's own deadline
 * away and keep it fetching past the hours the operator asked for. Neither
 * belongs in a script whose entire job is to stay inside a provider's
 * tolerance. server/poller.ts and server/routeResolver.ts draw the same
 * line for the same reason: a wall clock is not a stopwatch.
 */
const monotonicNow = () => performance.now();
// Radius and centres are imported, not copied. TILE_RADIUS_NM is the margin
// under a provider ceiling that has moved twice in two months; a third copy
// of it here would be the one nobody updates.
const GRID = buildTileGrid();
const TILES_URL = (lat, lon) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${TILE_RADIUS_NM}`;
// Tiles per sampling round, taken from the grid in rotation. A round is 20
// tiles at the 1.5 s courtesy spacing (~40 s with latency), and the gate in
// the main loop lets only one round start every 20 minutes: the sampler
// walks ~58 tiles an hour, so the 546 of the grid take ~9.3 h — not the
// ~14 min a back-to-back walk would suggest. That is why gridCursor is
// PERSISTED in the cache file: with it only in memory a 4 h run covered
// tiles 0..239 and every resumed run — the way this script is meant to be
// used — started again at tile 0, so nothing past tile 240 was ever
// sampled. Unlike the server's poller this has no dormancy, so the price of
// a single definition is the empty tiles, 1.5 s each.
const TILES_PER_ROUND = 20;
/** Position in the grid rotation. Restored from the cache file below. */
let gridCursor = 0;
/** Rounds cut short by a refusing tile provider. Reported at exit. */
let sampleBlockedRounds = 0;

const hoursArg = process.argv.indexOf('--hours');
const RUN_HOURS = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 4;

// Conservative and self-correcting: start slow, back off hard on 429.
// MIN_DELAY_MS is the project floor of one request per 1.5 s. The loop below
// MUST await this between lookups: an earlier draft computed delayMs, logged
// it, and never slept on it — measured at 185 req/s against a stubbed fetch
// while its own log claimed 0.67 req/s.
let delayMs = 2000;
const MIN_DELAY_MS = 1500;
const MAX_TRANSPORT_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------------
// Interlock. Taken BEFORE the first request of any kind.
//
// The dev server polls adsb.lol every 1.5 s and pumps adsbdb every 10 s. This
// script adds its own stream to both, and the two processes do not
// coordinate: simulated over three virtual hours the pair put 2 077 of
// adsbdb's 8 039 requests under the 1 500 ms floor. Worse, the 360 s silence
// below is this process's alone — a server left running sends 36 requests
// into every penalty, and a request sent during the penalty RENEWS it.
// ----------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
let releaseLock = () => {};
try {
  releaseLock = await acquireProviderLock({ port: PORT });
} catch (e) {
  console.error(`\nREFUSING TO START: ${e.message}\n`);
  process.exit(1);
}
// Every exit path, signals included: a lock left behind would make the next
// run refuse, and the guard would become the thing operators learn to delete.
process.on('exit', () => releaseLock());
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

const cache = new Map();
if (existsSync(OUT)) {
  const parsed = JSON.parse(readFileSync(OUT, 'utf8'));
  // Two shapes are accepted: the bare array written before the cursor
  // existed, and the envelope written since. A cache built by an older run
  // is hours of adsbdb lookups and must not be thrown away by a reader.
  const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
  for (const rec of records) cache.set(rec.callsign, rec.route);
  const saved = Array.isArray(parsed) ? 0 : Number(parsed.gridCursor);
  // Clamped: the grid is rebuilt from code on every run and may be shorter
  // than it was when the cursor was written.
  gridCursor = Number.isInteger(saved) && saved >= 0 ? saved % GRID.length : 0;
  console.log(`resuming from ${cache.size} cached callsigns, grid cursor ${gridCursor}/${GRID.length}`);
}

function save() {
  mkdirSync(dirname(OUT), { recursive: true });
  const records = [...cache.entries()]
    .map(([callsign, route]) => ({ callsign, route }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
  // The cursor travels WITH the answers, in one file and one write. A
  // sidecar file could be deleted, gitignored, or simply left out of the
  // task's `git add` line, and the sampler would silently restart at tile 0
  // again — which is the bug this whole envelope exists to kill.
  writeFileSync(OUT, JSON.stringify({ gridCursor, records }, null, 0));
}

async function sampleFeed() {
  const out = new Set();
  const firstTile = GRID[gridCursor].id;
  for (let i = 0; i < TILES_PER_ROUND; i++) {
    const { lat, lon } = GRID[gridCursor].centre;
    // Advance before the fetch and keep the index normalised: what gets
    // written to the cache file has to be a real index into the grid.
    gridCursor = (gridCursor + 1) % GRID.length;
    try {
      const res = await fetch(TILES_URL(lat, lon), {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      // No `continue` on a bad status: it would skip the courtesy sleep at
      // the bottom of the loop, and a provider answering 403 or 429 to every
      // tile would be hit 20 times with no spacing at all — the one moment
      // the spacing matters most.
      if (!res.ok) {
        // A refusal is not a tile to skip: it is a provider saying stop.
        // Measured on the first real run, 9 of 20 tiles answered 429 while
        // this branch only logged and carried on — 1.5 s apart, but still
        // knocking for the rest of the round. The adsbdb half of this script
        // already learned that lesson (lookupPolicy.ts); the tile half had
        // not.
        //
        // The silence is NOT the 360 s the lookups take, because adsb.lol and
        // adsbdb are different providers and a block on the sampler must not
        // stall lookups that are still welcome. Sampling simply stops for this
        // round and resumes at the next one, ~20 minutes away. The cursor is
        // rewound to the refused tile so no part of the grid is skipped.
        if (classifyLookupStatus(res.status) === 'blocked') {
          gridCursor = (gridCursor - 1 + GRID.length) % GRID.length;
          console.warn(
            `[sample] tile ${lat},${lon}: HTTP ${res.status} — provider refusing, ` +
              `ending this round at ${i + 1}/${TILES_PER_ROUND} tiles, cursor held at ${gridCursor}`
          );
          sampleBlockedRounds += 1;
          return out;
        }
        console.warn(`[sample] tile ${lat},${lon}: HTTP ${res.status}`);
      } else {
        const data = await res.json();
        for (const ac of data.ac ?? []) {
          const cs = (ac.flight ?? '').trim().toUpperCase();
          if (CALLSIGN_RX.test(cs)) out.add(cs);
        }
      }
    } catch (e) {
      console.warn(`[sample] tile ${lat},${lon}: ${e.message}`);
    }
    await sleep(1500); // same courtesy rate as everything else
  }
  // Printed so the walk is auditable from outside the process: Step 3 reads
  // this line from two consecutive runs to prove the cursor really survived.
  console.log(`[sample] walked ${TILES_PER_ROUND} tiles from ${firstTile}, cursor now ${gridCursor}/${GRID.length}`);
  return out;
}

/**
 * Asks adsbdb about one callsign.
 *
 * The STATUS travels back with the verdict: it used to be thrown away, so a
 * provider answering 403 to everything for three hours produced 5 265
 * requests and not one line of output that differed from a healthy run.
 *
 * @returns {Promise<{verdict: 'ok'|'unknown'|'blocked'|'error', status: number|null}>}
 */
async function lookup(cs) {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  const verdict = classifyLookupStatus(res.status);
  if (verdict === 'unknown') {
    cache.set(cs, null);
    return { verdict, status: res.status };
  }
  if (verdict !== 'ok') return { verdict, status: res.status };
  const data = await res.json();
  const fr = typeof data.response === 'object' ? data.response?.flightroute : undefined;
  const o = fr?.origin, d = fr?.destination;
  if (!fr || !o?.iata_code || !o?.name || !d?.iata_code || !d?.name) {
    cache.set(cs, null);
    return { verdict: 'unknown', status: res.status };
  }
  cache.set(cs, {
    callsignIcao: fr.callsign ?? cs,
    callsignIata: fr.callsign_iata ?? null,
    airlineName: fr.airline?.name ?? null,
    originIata: o.iata_code,
    originName: o.name,
    destinationIata: d.iata_code,
    destinationName: d.name,
  });
  return { verdict: 'ok', status: res.status };
}

const deadline = monotonicNow() + RUN_HOURS * 3600_000;
const pending = [];
const attempts = new Map();
// lastSample starts at -Infinity, not 0: on a monotonic clock 0 is this
// process's own start, so `monotonicNow() - 0` is milliseconds of uptime and
// the first sampling round would wait twenty minutes before firing. The gate
// has to be open on the first pass, which is what `Date.now() - 0` gave for
// free and a stopwatch does not.
let resolvedCount = 0, unknownCount = 0, abandonedCount = 0, lastSample = -Infinity;
// Attempts, not successes. The progress line used to be gated on
// `resolvedCount + unknownCount > 0`, which never becomes true when the
// provider refuses everything — the exact run that most needs a progress
// line was the one that printed none. `failedCount` is in the line so the
// mix is visible, `badInWindow` keeps the spacing from creeping back toward
// the floor on a run that is not actually healthy, and `consecutiveRefusals`
// is what ends a run the provider keeps saying no to.
let attemptCount = 0, failedCount = 0, consecutiveRefusals = 0, badInWindow = false;
let aborted = null;

console.log(`building for ${RUN_HOURS}h, starting at ${(1000 / delayMs).toFixed(2)} req/s`);

while (monotonicNow() < deadline) {
  // Re-sample the feed every 20 minutes: traffic turns over through the day.
  if (monotonicNow() - lastSample > 20 * 60_000) {
    try {
      const seen = await sampleFeed();
      let added = 0;
      for (const cs of seen) {
        if (!cache.has(cs) && !pending.includes(cs)) { pending.push(cs); added++; }
      }
      lastSample = monotonicNow();
      // Saved at once: the cursor on disk is the only thing that makes the
      // next run walk NEW tiles, and a run stopped with Ctrl-C between two
      // progress saves would otherwise re-walk the round it just finished.
      save();
      console.log(`[sample] ${seen.size} callsigns in feed, ${added} new, ${pending.length} pending, ${cache.size} cached`);
    } catch (e) {
      console.warn(`[sample] failed: ${e.message}`);
    }
  }

  if (pending.length === 0) { await sleep(5000); continue; }

  const cs = pending.shift();
  let outcome;
  try {
    outcome = await lookup(cs);
  } catch (e) {
    console.warn(`[lookup] ${cs}: ${e.message}`);
    outcome = { verdict: 'error', status: null };
  }

  // EVERY answer that is neither a route nor a 404 says so, with its status.
  // Nothing printed one before: `lookup()` warned on no status at all and the
  // warn below fires only for thrown exceptions, so three hours of 403s read
  // exactly like three hours of work.
  if (outcome.verdict === 'blocked' || outcome.verdict === 'error') {
    failedCount++;
    badInWindow = true;
    const what = outcome.status === null ? 'transport failure' : `HTTP ${outcome.status}`;
    console.warn(`[${outcome.verdict}] ${cs}: ${what}`);
  }

  // Refusals IN A ROW, and only answers count: a dropped connection is a
  // transport hiccup with its own per-callsign cap. The first usable answer
  // clears the count, so one 503 in a healthy hour cannot end a ten-hour run.
  if (outcome.verdict === 'ok' || outcome.verdict === 'unknown') {
    consecutiveRefusals = 0;
  } else if (outcome.status !== null) {
    consecutiveRefusals++;
  }

  if (shouldAbortRun(consecutiveRefusals)) {
    pending.unshift(cs);
    save();
    aborted = `adsbdb refused ${consecutiveRefusals} requests in a row (last HTTP ${outcome.status})`;
    console.error(`\n[abort] ${aborted}.`);
    console.error('[abort] Stopping rather than spending the rest of the run on a provider that is refusing us. Wait for the block to lift before trying again — requests sent during a penalty renew it.');
    break;
  }

  if (outcome.verdict === 'blocked') {
    // 403, 5xx and a Cloudflare page in front of the API are treated exactly
    // like the 429 that used to be the only refusal this script could see.
    pending.unshift(cs);
    delayMs = nextDelayAfterBlock(delayMs);
    save();
    console.warn(`[blocked] sleeping ${Math.round(BLOCK_SILENCE_MS / 1000)}s in total silence, new delay ${delayMs}ms — a request sent during the penalty renews it`);
    await sleep(BLOCK_SILENCE_MS);
    continue;
  }

  if (outcome.verdict === 'ok') {
    resolvedCount++;
    attempts.delete(cs);
  } else if (outcome.verdict === 'unknown') {
    unknownCount++;
    attempts.delete(cs);
  } else {
    // Transport hiccup, or an answer we cannot read: retry a bounded number
    // of times, then give up.
    // Without a cap a permanently failing callsign recirculates forever.
    const tried = (attempts.get(cs) ?? 0) + 1;
    if (tried >= MAX_TRANSPORT_ATTEMPTS) {
      // Record the verdict in `cache`, not just in a counter: the guard the
      // re-sampler consults is `cache.has(cs)`. Merely dropping it means the
      // next sample — every 20 minutes — queues it again with a fresh
      // counter, spending three more requests each time, for ever.
      cache.set(cs, null);
      attempts.delete(cs);
      abandonedCount++;
      console.warn(`[give up] ${cs} after ${tried} failed attempts`);
    } else {
      attempts.set(cs, tried);
      pending.push(cs);
    }
  }

  // THE THROTTLE. Everything above is bookkeeping; this line is what keeps us
  // inside adsbdb's tolerance. Never remove it, never make it conditional.
  attemptCount++;
  await sleep(delayMs);

  // Counted in ATTEMPTS, so the line prints whatever the answers are. The old
  // gate (`resolved + unknown > 0`) was silent for a whole run of refusals,
  // and its `> 0` was there because without it a failing lookup printed a
  // line every time: counting attempts satisfies both.
  if (attemptCount % 100 === 0) {
    save();
    const left = pending.length;
    const eta = (left * delayMs) / 3600_000;
    console.log(`resolved ${resolvedCount}, unknown ${unknownCount}, failed ${failedCount}, pending ${left}, delay ${delayMs}ms, eta ${eta.toFixed(1)}h`);
    // Creep back toward the floor only after a CLEAN hundred: speeding up
    // while a provider is refusing us is the opposite of backing off.
    if (!badInWindow && delayMs > MIN_DELAY_MS) delayMs = Math.max(MIN_DELAY_MS, delayMs * 0.9);
    badInWindow = false;
  }
}

save();
if (aborted !== null) {
  // Non-zero, and loud: a three-hour run that cached nothing must not look
  // like a three-hour run that worked.
  console.error(`\nABORTED: ${aborted}`);
  console.error(`${cache.size} callsigns cached in total (${resolvedCount} resolved, ${unknownCount} unknown, ${failedCount} failed this run), ${pending.length} still pending`);
  console.error(`grid cursor at ${gridCursor}/${GRID.length} — ${OUT} is saved and the next run resumes from it`);
  process.exitCode = 1;
} else {
  console.log(`\ndone: ${cache.size} callsigns cached (${resolvedCount} resolved, ${unknownCount} unknown, ${failedCount} failed, ${abandonedCount} abandoned this run), ${pending.length} still pending`);
  console.log(`grid cursor at ${gridCursor}/${GRID.length} — the next run samples from there`);
  if (sampleBlockedRounds > 0) {
    // Said out loud: a run that discovers no new callsigns because the tile
    // provider refused is not the same as a run that found nothing to do.
    console.warn(
      `${sampleBlockedRounds} sampling round(s) ended early because adsb.lol refused — ` +
        `fewer new callsigns were discovered than the grid walk suggests`
    );
  }
  console.log(`written to ${OUT} — commit it`);
}
