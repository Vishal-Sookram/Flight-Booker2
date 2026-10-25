import { Flight } from './flight.js';
import { CABINS } from './seat.js';
import { getAirport } from './airports.js';
import { ValidationError } from './errors.js';
import { pounds } from './money.js';
import { isValidDateKey, weekdayOfDateKey, zonedTimeToDate } from './timezones.js';

/**
 * The weekly flight schedule (src/data/schedule.json, built from the Django project's CSV files).
 *
 * A schedule row is "IndiGo 6E776 flies Delhi -> Mumbai at 08:00 every Tuesday". The catalog turns that into an
 * OFFER for one particular date: a real departure and arrival moment, using each airport's time zone. An offer is
 * only a description - nothing is created in the booking system until someone picks it (BookingService.ensureFlight).
 *
 * Row format: [flightNumber, origin, destination, departureMinutesLocal, weekday (0 = Mon), elapsedMinutes,
 *              airlineIndex, economyPounds, businessPounds | null, firstPounds | null]
 */
export class ScheduleCatalog {
  #airlines; #routes = new Map(); #size = 0; #lookup;

  /** @param data   the parsed schedule.json    @param lookup  airport lookup (a test can pass its own) */
  constructor(data, { lookup = getAirport } = {}) {
    if (!data || data.version !== 1 || !Array.isArray(data.flights) || !Array.isArray(data.airlines)) {
      throw new ValidationError('Unsupported flight schedule data.');
    }
    this.#airlines = data.airlines;
    this.#lookup = lookup;
    for (const row of data.flights) {
      const key = `${row[1]}-${row[2]}`;
      if (!this.#routes.has(key)) this.#routes.set(key, []);
      this.#routes.get(key).push(row);
      this.#size++;
    }
  }

  /** Number of weekly flights in the schedule. */
  get size() { return this.#size; }

  hasRoute(origin, destination) {
    return this.#routes.has(`${String(origin).toUpperCase()}-${String(destination).toUpperCase()}`);
  }

  /** Airport codes you can fly to from `origin`, sorted. */
  destinationsFrom(origin) {
    const from = String(origin).trim().toUpperCase();
    const codes = [];
    for (const key of this.#routes.keys()) {
      const [o, d] = key.split('-');
      if (o === from) codes.push(d);
    }
    return codes.sort();
  }

  /** Every airport that appears in the schedule. */
  servedAirports() {
    const codes = new Set();
    for (const key of this.#routes.keys()) key.split('-').forEach((c) => codes.add(c));
    return codes;
  }

  /**
   * The flights that operate on `date` ("2027-01-15", the date at the origin), earliest first.
   * Returns [] for an unknown route or a bad date.
   */
  offersFor({ origin, destination, date }) {
    const o = String(origin ?? '').trim().toUpperCase();
    const d = String(destination ?? '').trim().toUpperCase();
    if (!isValidDateKey(date)) return [];
    const rows = this.#routes.get(`${o}-${d}`);
    if (!rows) return [];
    const weekday = weekdayOfDateKey(date);
    const originZone = this.#lookup(o)?.timeZone ?? null;
    const destinationZone = this.#lookup(d)?.timeZone ?? null;
    return rows
      .filter((row) => row[4] === weekday)
      .map((row) => this.#toOffer(row, date, originZone, destinationZone))
      .sort((a, b) => a.departureTime - b.departureTime || a.flightNumber.localeCompare(b.flightNumber));
  }

  #toOffer([flightNumber, origin, destination, depMinutes, , elapsed, airlineIndex, economy, business, first], date, originZone, destinationZone) {
    const [airlineCode, airline] = this.#airlines[airlineIndex];
    const departureTime = zonedTimeToDate(date, depMinutes, originZone);
    return Object.freeze({
      id: `${flightNumber}-${origin}${destination}-${date.replace(/-/g, '')}`,
      flightNumber, airlineCode, airline, origin, destination, date,
      departureTime,
      arrivalTime: new Date(departureTime.getTime() + elapsed * 60000),
      durationMinutes: elapsed,
      originTimeZone: originZone,
      destinationTimeZone: destinationZone,
      fares: Object.freeze({
        [CABINS[0]]: pounds(economy),
        [CABINS[1]]: business == null ? null : pounds(business),
        [CABINS[2]]: first == null ? null : pounds(first),
      }),
    });
  }
}

/** Builds the real Flight (with its seat map) for an offer. It is not added to any BookingService by this. */
export function flightFromOffer(offer) {
  return new Flight(offer.flightNumber, offer.origin, offer.destination, offer.departureTime, offer.arrivalTime, {
    id: offer.id,
    airline: offer.airline,
    fares: offer.fares,
    originTimeZone: offer.originTimeZone,
    destinationTimeZone: offer.destinationTimeZone,
  });
}
