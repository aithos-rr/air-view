// Run with: npm run build:static
//
// Under tsx, never under bare node: this script IMPORTS the coastline codec,
// which is TypeScript, the way build-route-cache.mjs imports the tile grid.
// A binary format aligned by hand would have been a fourth copy of a number
// in a repo that has already paid for three, and the worst kind: a
// misalignment would not raise an error, it would draw a coastline that is
// not there (D40).
//
// Downloads and transforms upstream open data into public/data/ assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeCoastline, COASTLINE_UNITS_PER_DEGREE } from '../src/globe/coastlineCodec.js';

const OUT = 'public/data';
await fs.mkdir(OUT, { recursive: true });

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const OPENFLIGHTS = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';
const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';

// Kept in step with src/data/sources/userAgent.ts by hand: this file is .mjs
// and runs outside both TypeScript programs, so it cannot import that
// constant. The plan's global constraint is that EVERY outgoing request
// identifies the project — these four downloads were the exception.
const USER_AGENT = 'air-view/2.0 (+https://air-view-production.up.railway.app)';

async function downloadText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

// 0,0008 deg = 89 m = half a pixel at the deepest zoom the camera reaches
// (0,0989 NM/px at CAMERA_NEAR_LIMIT = 1,55, src/globe/geoHelpers.ts).
// Measured: at this tolerance simplification keeps 92 % of the points, so
// the saving comes from the ENCODING, not from dropping detail. At 0,012
// the file would be 0,68 MB and the error 7,3 px — half a symbol, i.e. the
// coastline would lie more than the 50m level lies today.
const COASTLINE_TOLERANCE_DEG = 0.0008;

/** Perpendicular distance from p to the segment ab, in degrees. */
function segmentDistanceDeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker, iterative so a 40 000 point ring cannot blow the stack. */
function simplifyRing(points, toleranceDeg) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let worst = -1;
    let worstAt = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceDeg(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > toleranceDeg && worstAt > 0) {
      keep[worstAt] = 1;
      stack.push([first, worstAt], [worstAt, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * The OUTER rings of a Natural Earth admin-0 collection, read exactly the way
 * src/globe/continents.ts reads them: outer rings only, Antarctica skipped.
 */
function outerRings(geojson) {
  const rings = [];
  for (const f of geojson.features) {
    if (f.properties.CONTINENT === 'Antarctica') continue;
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      if (ring) rings.push(ring);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        const ring = poly[0];
        if (ring) rings.push(ring);
      }
    }
  }
  return rings;
}

// 1a. Natural Earth 50m countries, verbatim: the COARSE coastline level,
// unchanged. It is what the globe draws until the zoom asks for more.
{
  const name = 'ne_50m_admin_0_countries';
  const text = await downloadText(`${NE}/${name}.geojson`);
  await fs.writeFile(path.join(OUT, `${name}.geojson`), text);
  console.log(`  ${name}.geojson  ${(text.length / 1024).toFixed(0)} KB`);
}

// 1b. Natural Earth 10m countries → coastline-10m.bin, the FINE level.
//
// The GeoJSON is 13 287 234 bytes and almost all of it is syntax and 137
// properties per feature, of which none are needed. Geometry alone, as Int16
// deltas at 1e-5 degrees, is 2,06 MB — less than the 2,94 MB of 50m already
// shipped (D40).
{
  const text = await downloadText(`${NE}/ne_10m_admin_0_countries.geojson`);
  console.log(`  ne_10m_admin_0_countries.geojson  ${(text.length / 1024).toFixed(0)} KB downloaded`);
  const rings = outerRings(JSON.parse(text));
  let pointsBefore = 0;
  let pointsAfter = 0;
  const encoded = [];
  for (const ring of rings) {
    pointsBefore += ring.length;
    const simplified = simplifyRing(ring, COASTLINE_TOLERANCE_DEG);
    pointsAfter += simplified.length;
    const flat = new Int32Array(simplified.length * 2);
    for (let i = 0; i < simplified.length; i++) {
      flat[i * 2] = Math.round(simplified[i][0] * COASTLINE_UNITS_PER_DEGREE);
      flat[i * 2 + 1] = Math.round(simplified[i][1] * COASTLINE_UNITS_PER_DEGREE);
    }
    encoded.push(flat);
  }
  const buffer = encodeCoastline(encoded);
  await fs.writeFile(path.join(OUT, 'coastline-10m.bin'), Buffer.from(buffer));
  // The figures of plan §2.3 have to stay checkable after every rebuild, so
  // they are printed rather than remembered.
  let runCount = 0;
  {
    const view = new DataView(buffer);
    let at = 20;
    const ringCount = view.getUint32(12, true);
    for (let r = 0; r < ringCount; r++) {
      const runs = view.getUint32(at, true);
      at += 4;
      runCount += runs;
      for (let k = 0; k < runs; k++) {
        const deltaCount = view.getUint32(at + 8, true);
        at += 12 + deltaCount * 4;
      }
    }
  }
  console.log(
    `  coastline-10m.bin  ${buffer.byteLength} B  ` +
      `${encoded.length} rings  ${runCount} runs  ` +
      `${pointsAfter}/${pointsBefore} points kept ` +
      `(${((100 * pointsAfter) / pointsBefore).toFixed(1)} %)`
  );
}

// 1c. Natural Earth 50m populated places → cities.json.
//
// The verbatim file was 3 350 885 bytes of which six fields out of 137 are
// read, and NOBODY read it: it sat in the bundle unopened. It is downloaded,
// transformed, and NOT written out — exactly what this script already does
// for airports and airlines (D45).
//
// Sorted once here, by (SCALERANK, LABELRANK, -POP_MAX), so that at runtime
// a map scale is a PREFIX of the array and selecting is a walk from index 0.
{
  const text = await downloadText(`${NE}/ne_50m_populated_places.geojson`);
  const places = [];
  for (const f of JSON.parse(text).features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    if (typeof p.NAME !== 'string' || p.NAME.length === 0) continue;
    places.push({
      n: p.NAME,
      s: typeof p.SCALERANK === 'number' ? p.SCALERANK : 10,
      l: typeof p.LABELRANK === 'number' ? p.LABELRANK : 10,
      // Unknown is null, never a plausible figure: nothing reads it for a
      // threshold, it is only the last tie-break.
      p: typeof p.POP_MAX === 'number' ? p.POP_MAX : null,
      // Four decimals is 11 m, a tenth of a pixel at the bottom of the
      // camera's travel.
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
    });
  }
  places.sort((a, b) => a.s - b.s || a.l - b.l || (b.p ?? 0) - (a.p ?? 0));
  const json = JSON.stringify(places);
  await fs.writeFile(path.join(OUT, 'cities.json'), json);
  // The verbatim GeoJSON is TRACKED by git, so it has to leave the disk here
  // for `git add` on its path to stage the deletion. Without this the 3,2 MB
  // D45 claims to save are not saved.
  await fs.rm(path.join(OUT, 'ne_50m_populated_places.geojson'), { force: true });
  console.log(`  cities.json  ${json.length} B  ${places.length} places`);
  console.log('  ne_50m_populated_places.geojson  removed (3 350 885 B that nothing read)');
}

// 3. OpenFlights airlines.dat → airlines.json (ICAO ↔ IATA mapping)
const airlinesCsv = await downloadText(`${OPENFLIGHTS}/airlines.dat`);
const airlines = [];
for (const line of airlinesCsv.split('\n')) {
  if (!line.trim()) continue;
  const cols = line.split(',');
  if (cols.length < 8) continue;
  const [, name, , iata, icao, , , active] = cols;
  if (active !== '"Y"') continue;
  const cleanIata = iata?.replace(/^"|"$/g, '');
  const cleanIcao = icao?.replace(/^"|"$/g, '');
  const cleanName = name?.replace(/^"|"$/g, '');
  if (!cleanIcao || cleanIcao === '\\N' || cleanIcao.length !== 3) continue;
  airlines.push({ icao: cleanIcao, iata: cleanIata, name: cleanName });
}
await fs.writeFile(path.join(OUT, 'airlines.json'), JSON.stringify(airlines));
console.log(`  airlines.json  ${airlines.length} airlines`);

// 4. OurAirports airports.csv → airports.json (with IATA timezone enrichment)
const airportsCsv = await downloadText(`${OURAIRPORTS}/airports.csv`);
const lines = airportsCsv.split('\n').slice(1);
const airports = [];
for (const line of lines) {
  if (!line.trim()) continue;
  const cols = parseOurAirportsRow(line);
  if (!cols) continue;
  const { ident: icao, type, name, lat, lon, country, city, iata } = cols;
  if (type !== 'large_airport' && type !== 'medium_airport') continue;
  if (!iata || iata.length !== 3) continue;
  airports.push({ iata, icao, name, lat, lon, country, city });
}

// 5. Enrich airports with IANA timezones via lat/lon lookup using tz-lookup
// tz-lookup is a small zero-dep package (~3 MB, JSON tables baked in)
let lookup;
try {
  const mod = await import('tz-lookup');
  lookup = mod.default ?? mod;
} catch {
  console.warn('tz-lookup not installed; airports will default to UTC. Install via: npm install --no-save tz-lookup');
}

for (const ap of airports) {
  if (lookup && Number.isFinite(ap.lat) && Number.isFinite(ap.lon)) {
    try {
      ap.timezone = lookup(ap.lat, ap.lon);
    } catch {
      ap.timezone = 'UTC';
    }
  } else {
    ap.timezone = 'UTC';
  }
}

await fs.writeFile(path.join(OUT, 'airports.json'), JSON.stringify(airports));
console.log(`  airports.json  ${airports.length} airports`);

// Naive CSV row parser for OurAirports (handles quoted fields with embedded commas)
function parseOurAirportsRow(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  if (fields.length < 14) return null;
  return {
    ident: fields[1],
    type: fields[2],
    name: fields[3],
    lat: parseFloat(fields[4]),
    lon: parseFloat(fields[5]),
    country: fields[8],
    city: fields[10],
    iata: fields[13],
  };
}

console.log('Static data build complete.');
