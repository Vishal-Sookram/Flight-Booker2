import { AIRPORTS } from './airportData.js';

/**
 * The airport directory (from the Django project's airports.csv, cleaned by scripts/build-schedule.mjs).
 * { code, city, name, country, timeZone, served, aliases? } - `served` means the schedule has flights there.
 */
export { AIRPORTS };

const BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));

const norm = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Looks an airport up by its 3-letter code (any case). Returns null if unknown. */
export function getAirport(code) {
  return BY_CODE.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

/** The airport's IANA time zone, or null when unknown. */
export function timeZoneOf(code) {
  return getAirport(code)?.timeZone ?? null;
}

/** "London (LHR)"; just the code when the airport is not in the directory. */
export function airportLabel(code) {
  const a = getAirport(code);
  return a ? `${a.city} (${a.code})` : String(code ?? '');
}

/** "London" - or the code itself when unknown. */
export function cityOf(code) {
  return getAirport(code)?.city ?? String(code ?? '');
}

/** How well an airport matches the (already normalised) query: 0 = not at all, higher = better. */
function score(airport, q) {
  const code = airport.code.toLowerCase();
  const city = norm(airport.city);
  const name = norm(airport.name);
  const country = norm(airport.country);
  const aliases = (airport.aliases ?? []).map(norm);
  if (code === q) return 100;
  if (city === q || aliases.includes(q)) return 90;
  if (code.startsWith(q)) return 80;
  if (city.startsWith(q) || aliases.some((a) => a.startsWith(q))) return 70;
  const words = [...city.split(/[\s-]+/), ...name.split(/[\s\-/]+/), ...country.split(/\s+/)];
  if (words.some((w) => w.startsWith(q))) return 50;
  if ([city, name, country, ...aliases].some((t) => t.includes(q))) return 30;
  return 0;
}

/**
 * Finds airports for a search box (the Django project's /query/places/<q> endpoint, but offline and ranked).
 * Matches code, city, airport name, country and a few nicknames ("Bombay"), ignoring case and accents.
 * Exact code matches come first, then city names, then everything else.
 *
 * @param query   what the person typed
 * @param limit   most results to return
 * @param codes   optional list/Set of codes - only these airports are considered
 */
export function searchAirports(query, { limit = 8, codes = null } = {}) {
  const q = norm(query);
  if (q === '') return [];
  const allowed = codes ? new Set([...codes].map((c) => String(c).toUpperCase())) : null;
  return AIRPORTS
    .filter((a) => !allowed || allowed.has(a.code))
    .map((a) => ({ a, s: score(a, q) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || Number(y.a.served) - Number(x.a.served) || x.a.city.localeCompare(y.a.city) || x.a.code.localeCompare(y.a.code))
    .slice(0, limit)
    .map((x) => x.a);
}

/** Codes of every airport that has flights: the schedule's airports plus any extra codes (flights added by hand). */
export function servedAirportCodes(extraCodes = []) {
  const codes = new Set(AIRPORTS.filter((a) => a.served).map((a) => a.code));
  for (const code of extraCodes) codes.add(String(code).toUpperCase());
  return codes;
}
