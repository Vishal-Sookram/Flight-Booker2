#!/usr/bin/env node
/**
 * Builds the app's airport directory and flight schedule from the CSV files that ship with the
 * "Flight-Ticket-Booking" Django project (Data/airports.csv, domestic_flights.csv, international_flights.csv).
 *
 *   node scripts/build-schedule.mjs <folder-with-the-three-csv-files>
 *
 * Writes:
 *   src/domain/airportData.js   the airport directory (small, bundled with the app)
 *   src/data/schedule.json      the weekly flight schedule (large, loaded on demand)
 *
 * The CSVs are NOT usable as-is, so this script cleans them (every fix is counted and printed):
 *   1. Flight numbers like "6.00E+155" are IndiGo's "6E155" mangled by a spreadsheet into scientific notation.
 *   2. Some flights appear twice for the same weekday with different fares - the cheapest row is kept.
 *   3. A business/first fare that is not higher than the cabin below it is bad data and is dropped
 *      (that cabin is then simply "not offered" on that flight).
 *   4. Fares are in Indian rupees; the app works in pounds, so they are converted at a fixed rate (INR_PER_GBP).
 *   5. The CSV "duration" is NOT the flight time - it is the difference between the two local clock times
 *      (so New York -> London shows as 12h10m). The real elapsed time is recovered from the airports' time zones.
 *   6. A few misspelt city names are corrected (Naqpur -> Nagpur, ...).
 *
 * No dependencies: plain Node (18+).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) {
  console.error('Usage: node scripts/build-schedule.mjs <folder containing airports.csv, domestic_flights.csv, international_flights.csv>');
  process.exit(1);
}

/** Fixed demo exchange rate: 110 rupees to the pound. Change it here and re-run to re-price everything. */
const INR_PER_GBP = 110;

/** The CSV times were captured in northern summer (see note 5). Elapsed time is derived on this date. */
const REFERENCE_DATE = { year: 2026, month: 7, day: 15 };

/** IANA time zone of every airport that has flights. The script stops if a served airport is missing here. */
const TIME_ZONES = {
  // India (all 30 domestic airports)
  AMD: 'Asia/Kolkata', ATQ: 'Asia/Kolkata', BLR: 'Asia/Kolkata', BOM: 'Asia/Kolkata', CCJ: 'Asia/Kolkata',
  CCU: 'Asia/Kolkata', CJB: 'Asia/Kolkata', COK: 'Asia/Kolkata', DEL: 'Asia/Kolkata', GAU: 'Asia/Kolkata',
  GOI: 'Asia/Kolkata', HYD: 'Asia/Kolkata', IDR: 'Asia/Kolkata', IXA: 'Asia/Kolkata', IXB: 'Asia/Kolkata',
  IXC: 'Asia/Kolkata', IXE: 'Asia/Kolkata', IXJ: 'Asia/Kolkata', IXM: 'Asia/Kolkata', IXZ: 'Asia/Kolkata',
  JAI: 'Asia/Kolkata', LKO: 'Asia/Kolkata', MAA: 'Asia/Kolkata', NAG: 'Asia/Kolkata', PAT: 'Asia/Kolkata',
  PNQ: 'Asia/Kolkata', SXR: 'Asia/Kolkata', TRV: 'Asia/Kolkata', TRZ: 'Asia/Kolkata', VTZ: 'Asia/Kolkata',
  // International
  AMS: 'Europe/Amsterdam', ATL: 'America/New_York', BCN: 'Europe/Madrid', BKK: 'Asia/Bangkok',
  CAN: 'Asia/Shanghai', CDG: 'Europe/Paris', CGK: 'Asia/Jakarta', CTU: 'Asia/Shanghai',
  DEN: 'America/Denver', DFW: 'America/Chicago', DMK: 'Asia/Bangkok', DXB: 'Asia/Dubai',
  FRA: 'Europe/Berlin', HKG: 'Asia/Hong_Kong', HND: 'Asia/Tokyo', ICN: 'Asia/Seoul',
  IST: 'Europe/Istanbul', JFK: 'America/New_York', KUL: 'Asia/Kuala_Lumpur', LAS: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles', LHR: 'Europe/London', MAD: 'Europe/Madrid', ORD: 'America/Chicago',
  PEK: 'Asia/Shanghai', PVG: 'Asia/Shanghai', SAW: 'Europe/Istanbul', SFO: 'America/Los_Angeles',
  SIN: 'Asia/Singapore', YYZ: 'America/Toronto',
};

/** Spelling fixes for the source data. */
const CITY_FIXES = { Naqpur: 'Nagpur', Changcha: 'Changsha', Tiruchirappally: 'Tiruchirappalli', Cheju: 'Jeju' };
const NAME_FIXES = { TRZ: 'Tiruchirappalli International Airport' };

/** Other names people search by (the city column holds one official name only). */
const ALIASES = {
  DEL: ['New Delhi'], BOM: ['Bombay'], BLR: ['Bengaluru'], CCU: ['Calcutta'], MAA: ['Madras'], GOI: ['Goa'],
  COK: ['Cochin'], TRV: ['Trivandrum'], CCJ: ['Kozhikode'], VTZ: ['Vizag'], IXB: ['Bagdogra'], PVG: ['Pudong'],
  CAN: ['Canton'], JFK: ['Kennedy'], DMK: ['Don Mueang'], BKK: ['Suvarnabhumi'], HND: ['Haneda'],
};

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────

function parseCsv(file) {
  const [header, ...lines] = readFileSync(join(SRC, file), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const names = header.split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(',');                                   // the source files have no quoted fields
    return Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()]));
  });
}

const minutesOf = (hhmmss) => { const [h, m] = hhmmss.split(':'); return Number(h) * 60 + Number(m); };
const stats = {};
const count = (key) => { stats[key] = (stats[key] ?? 0) + 1; };

const formatters = new Map();
function wallClock(instantMs, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(instantMs)).map((x) => [x.type, Number(x.value)]));
  return { utcOfWall: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute), minutes: p.hour * 60 + p.minute };
}
const offsetMs = (instantMs, tz) => wallClock(instantMs, tz).utcOfWall - Math.floor(instantMs / 60000) * 60000;

/** The instant at which the wall clock in `tz` reads the given date and minutes-of-day. */
function instantFromWall({ year, month, day }, minutes, tz) {
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = wall - offsetMs(wall, tz);
  guess = wall - offsetMs(guess, tz);
  return guess;
}

/**
 * Real flight time in minutes. The CSV gives the local departure and arrival clock times, so: where is the
 * destination's clock when the plane leaves, and how far is that from the arrival time (at least 30 minutes ahead).
 * Returns null if the answer does not check out (e.g. a clock change in mid-flight on the reference date).
 */
function elapsedMinutes(origin, destination, depMinutes, arrMinutes) {
  const dep = instantFromWall(REFERENCE_DATE, depMinutes, TIME_ZONES[origin]);
  const destTz = TIME_ZONES[destination];
  let elapsed = (((arrMinutes - wallClock(dep, destTz).minutes) % 1440) + 1440) % 1440;
  if (elapsed < 30) elapsed += 1440;
  return wallClock(dep + elapsed * 60000, destTz).minutes === arrMinutes ? elapsed : null;
}

// ── Read and clean ──────────────────────────────────────────────────────────────────────────────

const airportRows = parseCsv('airports.csv');
const flightRows = [...parseCsv('domestic_flights.csv'), ...parseCsv('international_flights.csv')];

const repairFlightNumber = (value) => {
  const m = /^6\.00E\+(\d+)$/i.exec(value);
  if (m) { count('flight numbers repaired (6.00E+nnn -> 6Ennn)'); return `6E${m[1]}`; }
  return value;
};

const best = new Map();       // key -> cheapest row for that flight / route / time / weekday
for (const r of flightRows) {
  const row = {
    flightNumber: repairFlightNumber(r.flight_no),
    origin: r.origin, destination: r.destination,
    dep: minutesOf(r.depart_time), arr: minutesOf(r.arrival_time),
    weekday: Number(r.depart_weekday),
    airlineCode: r.airline_code, airline: r.airline,
    economy: Number(r.economy_fare) || null,
    business: Number(r.business_fare) || null,
    first: Number(r.first_fare) || null,
  };
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(row.flightNumber)) { count('rows dropped: malformed flight number'); continue; }
  if (!TIME_ZONES[row.origin] || !TIME_ZONES[row.destination]) throw new Error(`No time zone for ${row.origin} or ${row.destination}: add it to TIME_ZONES.`);
  if (!row.economy) { count('rows dropped: no economy fare'); continue; }
  const key = [row.flightNumber, row.origin, row.destination, row.dep, row.weekday].join('|');
  const previous = best.get(key);
  if (previous) {
    count('duplicate rows merged (cheapest kept)');
    if (row.economy >= previous.economy) continue;
  }
  best.set(key, row);
}

const airlines = [];                                      // [code, name]
const airlineIndex = new Map();
const rows = [];
for (const r of best.values()) {
  if (r.business != null && r.business <= r.economy) { count('business fares dropped (not above economy)'); r.business = null; }
  if (r.first != null && r.first <= (r.business ?? r.economy)) { count('first-class fares dropped (not above the cabin below)'); r.first = null; }
  const elapsed = elapsedMinutes(r.origin, r.destination, r.dep, r.arr);
  if (elapsed == null) { count('rows dropped: could not work out flight time'); continue; }
  if (!airlineIndex.has(r.airlineCode)) { airlineIndex.set(r.airlineCode, airlines.length); airlines.push([r.airlineCode, r.airline]); }
  const gbp = (inr) => (inr == null ? null : Math.max(1, Math.round(inr / INR_PER_GBP)));
  rows.push([r.flightNumber, r.origin, r.destination, r.dep, r.weekday, elapsed, airlineIndex.get(r.airlineCode), gbp(r.economy), gbp(r.business), gbp(r.first)]);
}
rows.sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[4] - b[4] || a[3] - b[3] || a[0].localeCompare(b[0]));

// ── Airports ────────────────────────────────────────────────────────────────────────────────────

const served = new Set(rows.flatMap((r) => [r[1], r[2]]));
const airports = airportRows.map((a) => {
  if (CITY_FIXES[a.city]) count(`city names corrected (${a.city} -> ${CITY_FIXES[a.city]})`);
  return {
    code: a.code,
    city: CITY_FIXES[a.city] ?? a.city,
    name: NAME_FIXES[a.code] ?? a.airport,
    country: a.country,
    timeZone: TIME_ZONES[a.code] ?? null,
    served: served.has(a.code),
    ...(ALIASES[a.code] ? { aliases: ALIASES[a.code] } : {}),
  };
}).sort((a, b) => a.city.localeCompare(b.city) || a.code.localeCompare(b.code));

for (const code of served) if (!airports.some((a) => a.code === code)) throw new Error(`Flights use airport ${code}, which is not in airports.csv`);

// ── Write ───────────────────────────────────────────────────────────────────────────────────────

const airportModule = `// GENERATED by scripts/build-schedule.mjs from the Flight-Ticket-Booking airports.csv - do not edit by hand.
// \`served\` is true when the schedule has at least one flight to or from the airport.
// \`timeZone\` (IANA name) is only filled in for served airports.
export const AIRPORTS = [
${airports.map((a) => ` ${JSON.stringify(a)},`).join('\n')}
];
`;

mkdirSync(join(ROOT, 'src/data'), { recursive: true });
writeFileSync(join(ROOT, 'src/domain/airportData.js'), airportModule);
writeFileSync(join(ROOT, 'src/data/schedule.json'), JSON.stringify({
  _about: 'GENERATED by scripts/build-schedule.mjs - do not edit by hand. Row = [flightNumber, origin, destination, departureMinutesLocal, weekday(0=Mon), elapsedMinutes, airlineIndex, economyGBP, businessGBP|null, firstGBP|null]',
  version: 1,
  inrPerGbp: INR_PER_GBP,
  airlines,
  flights: rows,
}).replace('"flights":[[', '"flights":[\n[').replace(/\],\[/g, '],\n['));

console.log(`Airports: ${airports.length} (${served.size} with flights)`);
console.log(`Schedule: ${rows.length} weekly flights, ${airlines.length} airlines, ${new Set(rows.map((r) => `${r[1]}-${r[2]}`)).size} routes`);
console.log('Clean-up:');
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
