#!/usr/bin/env node
// Verifies the full data chain against the real upstream APIs.
// Usage: npm run server   (in another terminal)   then: npm run verify:feed
// Against production: BASE_URL=https://... npm run verify:feed

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}
function pass(msg) {
  console.log(`ok    ${msg}`);
}

const healthRes = await fetch(`${BASE}/health`);
const health = await healthRes.json();
console.log('health:', JSON.stringify(health));
if (healthRes.status !== 200) fail(`/health returned HTTP ${healthRes.status} (status: ${health.status})`);
else pass(`/health 200, status ${health.status}`);

const res = await fetch(`${BASE}/api/states`);
if (!res.ok) {
  fail(`/api/states returned HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const ac = Array.isArray(data.aircraft) ? data.aircraft : [];
if (!Array.isArray(data.aircraft)) fail(`payload has no aircraft array (${JSON.stringify(data.aircraft)}) — /api/states is not answering with the feed shape`);

// Every coverage gate below divides by ac.length, and on an empty fleet
// that is 0/0 = NaN. NaN fails NO comparison: `NaN < 0.8` is false, so the
// registration gate printed `NaN%` and PASSED on exactly the dead feed this
// script exists to condemn. ratio() yields null instead of NaN, and every
// caller treats null as a failure rather than as a pass.
const ratio = (n, d) => (Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null);
const pct = (n, d) => {
  const r = ratio(n, d);
  return r === null ? 'n/a' : `${(100 * r).toFixed(1)}%`;
};

pass(`source: ${data.source}`);
pass(`aircraft: ${ac.length}`);
if (health.tiles) console.log(`tiles: ${JSON.stringify(health.tiles)}`);
if (health.fleet) console.log(`fleet: ${JSON.stringify(health.fleet)}`);
console.log(`x-feed-stale: ${res.headers.get('x-feed-stale')}`);

// The payload is not a function of what you are looking at: this endpoint
// serves the whole accumulated fleet and ignores the bbox on purpose, so its
// size follows the retention window. Measured here rather than assumed.
if (!health.payload) {
  fail('/health does not report payload size — the body can only be guessed at from outside');
} else {
  const p = health.payload;
  const ratio = p.gzipBytes ? p.bytes / p.gzipBytes : 0;
  console.log(`payload: ${p.aircraft} aircraft, ${(p.bytes / 1e6).toFixed(2)} MB raw, ${(p.gzipBytes / 1e6).toFixed(2)} MB gzip, ${(p.bytes / Math.max(p.aircraft, 1)).toFixed(0)} B/aircraft`);
  if (p.bytes > 10_000_000) fail(`payload is ${(p.bytes / 1e6).toFixed(1)} MB — lower MAX_RETENTION_S, or MAX_PAYLOAD_AIRCRAFT if the window is already at the floor`);
  else pass(`payload under the 10 MB ceiling`);
  if (p.gzipBytes === 0) fail('payload was never compressed — every client would pay the full body');
  else if (ratio < 5) fail(`compression only ${ratio.toFixed(1)}x — is the raw body being served under a gzip header?`);
  else pass(`compression ${ratio.toFixed(1)}x`);
  if (p.capped) fail(`payload capped at ${p.aircraft} of ${p.maxAircraft}: the fleet outgrew the ceiling and the world served is partial`);
  else pass('payload not capped');
}

// The fleet fills in tile by tile: a server that has just started has
// legitimately seen only part of the world. Below a few hundred after a
// full sweep, something is wrong.
if (ac.length < 300) fail(`only ${ac.length} aircraft — has a full sweep completed? tiles: ${JSON.stringify(health.tiles)}`);

// Dormancy is expected over ocean, but the dormant counter alone CANNOT see
// the failure this gate claims to catch: productive is tiles.length minus
// the dormant set, and a tile joins that set only through
// scheduler.record(tileId, 0), which runCycle calls on its success branch.
// If every fetch fails nothing is recorded, productive stays at its maximum,
// and the gate reports a world in perfect health while not one aircraft
// arrives. So the tile counters are cross-checked against the three signals
// that do move when the upstream dies: the age of the feed, the last error
// the poller saw, and the size of the fleet.
const tiles = health.tiles;
if (!tiles || !Number.isFinite(tiles.productive) || !Number.isFinite(tiles.total)) {
  fail(`/health carries no usable tile stats (${JSON.stringify(tiles)}) — the scheduler is not wired into /health`);
} else {
  if (tiles.productive < 20) fail(`only ${tiles.productive} productive tiles of ${tiles.total} — the grid or the source is broken`);
  else pass(`${tiles.productive} productive tiles, ${tiles.dormant} dormant`);

  // After three full sweeps every ocean-edge tile has come back empty three
  // times and must be dormant (dormantAfterEmptySweeps defaults to 3). Zero
  // dormant tiles after three sweeps means no sweep result was ever
  // recorded, which is what a wholly failing upstream looks like from here.
  if (tiles.sweepsCompleted >= 3 && tiles.dormant === 0) {
    fail(`${tiles.sweepsCompleted} sweeps completed and not one dormant tile — tiles are recorded only on success, so this is the shape of an upstream failing every fetch`);
  } else if (!(tiles.sweepsCompleted >= 3)) {
    console.log(`note: ${tiles.sweepsCompleted} sweeps completed — the dormancy cross-check needs three (~41 min of polling)`);
  }

  if (tiles.suspendedUntil) fail(`tile polling suspended until ${tiles.suspendedUntil} — the tile sources rate-limited us`);
}

// Liveness, read without going through any tile counter.
if (!Number.isFinite(health.feedAgeSeconds)) {
  fail(`/health reports feedAgeSeconds ${JSON.stringify(health.feedAgeSeconds)} — no cycle has ever landed a payload`);
} else if (health.feedAgeSeconds > 180) {
  fail(`/health feed is ${health.feedAgeSeconds}s old — a cycle is ~13 s, so the poller is running and nothing is landing`);
} else {
  pass(`/health feed age: ${health.feedAgeSeconds}s`);
}

if (!Number.isFinite(health.fleet?.size) || health.fleet.size === 0) {
  fail(`fleet holds ${JSON.stringify(health.fleet?.size)} aircraft — whatever the tile counters say, nothing is being absorbed`);
} else {
  pass(`fleet holds ${health.fleet.size} aircraft`);
}

// lastError is cleared by the next successful cycle and a cycle is ~13 s, so
// an error standing next to a fresh feed is one tile that failed and
// recovered. Standing next to a stale feed it is the diagnosis.
if (health.lastError && Number.isFinite(health.feedAgeSeconds) && health.feedAgeSeconds <= 60) {
  console.log(`note: last tile error "${health.lastError}" (${health.lastErrorCode ?? 'no code'}), but a cycle landed ${health.feedAgeSeconds}s ago`);
} else if (health.lastError) {
  fail(`tiles are failing: ${health.lastError} (${health.lastErrorCode ?? 'no code'})`);
} else {
  pass('no outstanding tile error');
}

const ageS = (Date.now() - new Date(data.fetchedAt).getTime()) / 1000;
// Same NaN trap as the coverage gates: a missing or unparsable fetchedAt
// makes ageS NaN and `NaN > 600` is false, so a payload with no timestamp at
// all printed `feed age: NaNs` and counted as a pass.
if (!Number.isFinite(ageS)) {
  fail(`fetchedAt is missing or unparsable (${JSON.stringify(data.fetchedAt)}) — the payload carries no feed timestamp`);
} else if (ageS > 600) {
  fail(`fetchedAt is ${Math.round(ageS)}s old — the feed is not live`);
} else {
  pass(`feed age: ${Math.round(ageS)}s`);
}

// A timestamp far in the past or future means a seconds/milliseconds mixup
// in an adapter — the kind of bug unit tests with hand-made mocks miss.
if (Number.isFinite(ageS) && (ageS < -60 || ageS > 86_400)) fail(`fetchedAt is implausible (${Math.round(ageS)}s) — check the epoch units in the source adapter`);

const withReg = ac.filter((a) => a.registration).length;
const withModel = ac.filter((a) => a.modelCode).length;
console.log(`registration: ${withReg} of ${ac.length} (${pct(withReg, ac.length)})`);
console.log(`model: ${withModel} of ${ac.length} (${pct(withModel, ac.length)})`);
const regRatio = ratio(withReg, ac.length);
if (regRatio === null) fail('registration coverage is undefined because the fleet is empty — undefined is not 80%');
else if (regRatio < 0.8) fail(`registration coverage ${pct(withReg, ac.length)} is below 80% — the adapter may be dropping it`);
else pass(`registration coverage ${pct(withReg, ac.length)}`);

const withRoute = ac.filter((a) => a.route).length;
console.log(`route: ${withRoute} of ${ac.length} (${pct(withRoute, ac.length)}) — grows as the resolver cache fills`);
if (health.routes) console.log(`resolver: ${JSON.stringify(health.routes)}`);

// The completeness flag must actually reach the payload: isComplete() being
// written and tested but never wired up is a defect a green suite cannot see.
if (!('stale' in data)) fail('payload has no "stale" field — the freshness flag is header-only, and the client reads only JSON');
else pass(`stale flag in body: ${data.stale}`);

const complete = ac.filter((a) => a.complete === true).length;
if (ac.length === 0) fail('no aircraft at all — the "complete" flag cannot be checked, and an unchecked flag is not a passing one');
else if (ac.some((a) => a.complete === undefined)) fail('payload has no "complete" field — isComplete() is not wired into the response');
else pass(`complete: ${complete} of ${ac.length} (${pct(complete, ac.length)})`);
if (withRoute > 0 && complete === 0) fail('routes are attached but no aircraft is marked complete — check isComplete()');

// The route subsystem dying silently is the failure mode this script exists
// to catch. A conditional check that only fires when routes already exist
// would print PASSED on a server whose resolver has been rate-limited into
// oblivion — which is exactly what happened during review.
if (health.routes?.suspendedUntil) fail(`resolver suspended until ${health.routes.suspendedUntil} — adsbdb rate limit hit`);
else pass('resolver not rate-limited');

const seeded = (health.routes?.resolved ?? 0) + (health.routes?.unknown ?? 0);
// `=== 0` is the wrong test for the same reason as everywhere else here: a
// /health answering with a non-number makes the sum NaN, and NaN === 0 is
// false, so a missing or malformed resolver block would pass.
if (!Number.isFinite(seeded) || seeded === 0) fail(`resolver knows no callsign at all (${JSON.stringify(seeded)}) — is server/data/route-cache.json present and readable?`);
else pass(`resolver knows ${seeded} callsigns`);

if (health.routes?.lastError) console.log(`resolver lastError: ${health.routes.lastError}`);

// A request carrying bbox params must not 503 nor trigger its own upstream
// sweep: the writer and the reader of the cache must agree on the key.
const bboxRes = await fetch(`${BASE}/api/states?lamin=35&lomin=-15&lamax=72&lomax=45`);
if (bboxRes.status !== 200) fail(`/api/states with bbox returned HTTP ${bboxRes.status} — cache key mismatch between poller and handler`);
else pass('bbox request: HTTP 200');

// The v1 bug, asserted directly: no cluster of flights may share one route.
const counts = new Map();
for (const a of ac) {
  if (!a.route) continue;
  const k = `${a.route.originIata}->${a.route.destinationIata}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
const worst = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
if (worst && worst[1] > 30) fail(`${worst[1]} aircraft share the route ${worst[0]} — a fabricated route may be back`);
else if (worst) pass(`most common route ${worst[0]} appears ${worst[1]}x — no fabricated cluster`);

console.log(process.exitCode ? '\nVERIFICATION FAILED' : '\nVERIFICATION PASSED');
