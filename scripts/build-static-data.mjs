// Run with: node scripts/build-static-data.mjs
// Downloads and transforms upstream open data into public/data/ assets.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = 'public/data';
await fs.mkdir(OUT, { recursive: true });

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const OPENFLIGHTS = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';
const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';

async function downloadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

// 1. Natural Earth GeoJSONs (verbatim)
for (const name of ['ne_50m_admin_0_countries', 'ne_50m_populated_places']) {
  const text = await downloadText(`${NE}/${name}.geojson`);
  await fs.writeFile(path.join(OUT, `${name}.geojson`), text);
  console.log(`  ${name}.geojson  ${(text.length / 1024).toFixed(0)} KB`);
}

// 2. OpenFlights routes.dat → openflights-routes.json
// Format CSV: airline,airline_id,source_iata,source_id,dest_iata,dest_id,codeshare,stops,equipment
const routesCsv = await downloadText(`${OPENFLIGHTS}/routes.dat`);
const routes = [];
for (const line of routesCsv.split('\n')) {
  if (!line.trim()) continue;
  const cols = line.split(',');
  if (cols.length < 5) continue;
  const [airlineIata, , originIata, , destinationIata] = cols;
  if (!airlineIata || airlineIata === '\\N') continue;
  if (!originIata || originIata === '\\N' || originIata.length !== 3) continue;
  if (!destinationIata || destinationIata === '\\N' || destinationIata.length !== 3) continue;
  routes.push({ airlineIata, originIata, destinationIata });
}
await fs.writeFile(path.join(OUT, 'openflights-routes.json'), JSON.stringify(routes));
console.log(`  openflights-routes.json  ${routes.length} routes`);

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
