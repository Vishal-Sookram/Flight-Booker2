// Helpers shared by the domain tests (kept outside __tests__ so Jest doesn't treat it as a test file).
import { BookingService } from './bookingService.js';
import { ScheduleCatalog } from './schedule.js';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A clock the tests can move forward. */
export class MutableClock {
  constructor(start) { this.time = start.getTime(); }
  now = () => new Date(this.time);
  advance(ms) { this.time += ms; }
}

/** localStorage stand-in. */
export class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  setItem(key, value) { this.#data.set(key, String(value)); }
  removeItem(key) { this.#data.delete(key); }
}

/** Fixed "today" for tests: Sat 24 Oct 2026, 09:00 (local time). */
export const START = new Date(2026, 9, 24, 9, 0);

export function makeService({ seedDemo = false, storage = null, start = START, random } = {}) {
  const clock = new MutableClock(start);
  const service = new BookingService({ now: clock.now, storage, seedDemo, random });
  return { service, clock };
}

/**
 * A tiny schedule for tests. Weekdays: 2 = Wednesday, 4 = Friday. (Wed 4 Nov 2026 is 11 days after START;
 * Wed 13 Jan 2027 is 81 days after it, so the early-bird discount applies.)
 * Row: [flightNumber, origin, destination, departureMinutesLocal, weekday, elapsedMinutes, airlineIndex, economy, business, first] (pounds)
 */
export const FIXTURE_SCHEDULE = {
  version: 1,
  airlines: [['BA', 'British Airways'], ['VS', 'Virgin Atlantic']],
  flights: [
    ['BA117', 'LHR', 'JFK', 10 * 60 + 30, 2, 450, 0, 500, 1800, 4000],
    ['VS3', 'LHR', 'JFK', 18 * 60, 2, 460, 1, 450, null, null],          // economy only
    ['BA118', 'JFK', 'LHR', 19 * 60, 2, 420, 0, 520, 1900, null],
    ['BA119', 'LHR', 'JFK', 9 * 60, 4, 450, 0, 500, 1800, 4000],
  ],
};

export const fixtureCatalog = () => new ScheduleCatalog(FIXTURE_SCHEDULE);

/** Random numbers that are fixed for a given seed (so booking references are predictable in tests). */
export function seededRandom(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a flight departing `daysAhead` days after the clock's current day, at 10:00 (6h long). */
export function addFlight(service, clock, { number = 'BA0117', from = 'LHR', to = 'JFK', daysAhead = 10 } = {}) {
  const dep = new Date(clock.now().getFullYear(), clock.now().getMonth(), clock.now().getDate() + daysAhead, 10, 0);
  return service.addFlight({
    flightNumber: number, origin: from, destination: to,
    departureTime: dep, arrivalTime: new Date(dep.getTime() + 6 * HOUR),
  });
}

export function addPassengers(service, count = 3) {
  const people = [
    ['Alice Johnson', 'alice@email.com', 'GB123456'],
    ['Bob Smith', 'bob@email.com', 'GB654321'],
    ['Carol Williams', 'carol@email.com', 'GB246810'],
    ['David Brown', 'david@email.com', 'US135792'],
  ];
  return people.slice(0, count).map(([fullName, email, passport]) => service.registerPassenger({ fullName, email, passport }));
}

/** Blocks every free seat so the flight is completely full. */
export function fill(flight) {
  flight.availableSeats.forEach((seat) => flight.blockSeat(seat.seatNumber));
}
