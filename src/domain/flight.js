import { ValidationError } from './errors.js';
import { EconomySeat, BusinessSeat, FirstClassSeat, CABINS } from './seat.js';
import { formatDateTime } from './dates.js';
import { dateKeyOf, formatDateTimeIn, formatTimeIn, isValidTimeZone } from './timezones.js';

/** Where a flight is in its lifecycle. Only SCHEDULED flights can be booked or waitlisted. */
export const FlightStatus = Object.freeze({
  SCHEDULED: Object.freeze({ name: 'SCHEDULED', label: 'Scheduled', bookable: true }),
  BOARDING:  Object.freeze({ name: 'BOARDING',  label: 'Boarding',  bookable: false }),
  DEPARTED:  Object.freeze({ name: 'DEPARTED',  label: 'Departed',  bookable: false }),
  CANCELLED: Object.freeze({ name: 'CANCELLED', label: 'Cancelled', bookable: false }),
});

/** Booking closes this long before departure (the flight is then BOARDING). */
export const BOARDING_WINDOW_MS = 60 * 60 * 1000;

/** Name shown on seats taken by customers who are not in our passenger list. */
export const EXTERNAL_CUSTOMER = 'Other customer';

const requireText = (value, what) => {
  if (value == null || String(value).trim() === '') {
    throw new ValidationError(`${what} is required.`);
  }
  return String(value).trim();
};

/**
 * Checks per-cabin fares: { Economy: 12000, Business: 45000, 'First Class': null } (whole pence).
 * A cabin that is null / missing is NOT SOLD on this flight. Returns a frozen copy.
 */
function normaliseFares(fares, flightNumber) {
  const clean = {};
  for (const cabin of CABINS) {
    const value = fares[cabin];
    if (value == null) { clean[cabin] = null; continue; }
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(`The ${cabin} fare on ${flightNumber} must be a positive whole number of pence.`);
    }
    clean[cabin] = value;
  }
  if (CABINS.every((cabin) => clean[cabin] === null)) {
    throw new ValidationError(`Flight ${flightNumber} must sell at least one cabin.`);
  }
  return Object.freeze(clean);
}

const optionalZone = (zone, what) => {
  if (zone == null || zone === '') return null;
  if (!isValidTimeZone(zone)) throw new ValidationError(`${what} is not a known time zone: ${zone}`);
  return zone;
};

/**
 * A single flight with its seat map.
 * OOP concepts: encapsulation, collections (Map), polymorphism (Seat subclasses).
 *
 * `flightNumber` is the number printed on the ticket ("BA0117"). Because airlines fly the same number every day,
 * each flight also has an `id` that is unique per departure. For flights you add by hand the id IS the flight
 * number, so nothing changes; flights from the schedule use "6E776-DELBOM-20261105".
 *
 * Optional extras (all default to "none", which gives the original behaviour):
 *   airline, fares (per-cabin prices; a missing cabin is not sold), originTimeZone / destinationTimeZone
 *   (so times are shown as local airport time instead of the browser's time).
 */
export class Flight {
  #id; #flightNumber; #origin; #destination; #departureTime; #arrivalTime;
  #airline; #fares; #originTimeZone; #destinationTimeZone;
  #cancelled = false;
  #seatMap = new Map();            // "12C" -> Seat (in layout order)
  #externalSeats = new Set();      // seats held by other customers, so they can be saved and restored

  constructor(flightNumber, origin, destination, departureTime, arrivalTime, options = {}) {
    this.#flightNumber = requireText(flightNumber, 'Flight number').toUpperCase();
    this.#origin = requireText(origin, 'Origin').toUpperCase();
    this.#destination = requireText(destination, 'Destination').toUpperCase();
    if (this.#origin === this.#destination) {
      throw new ValidationError('Origin and destination must be different.');
    }
    const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());
    if (!valid(departureTime) || !valid(arrivalTime) || arrivalTime <= departureTime) {
      throw new ValidationError('A flight must arrive after it departs.');
    }
    this.#departureTime = departureTime;
    this.#arrivalTime = arrivalTime;
    const { id, airline, fares, originTimeZone, destinationTimeZone } = options ?? {};
    this.#id = id == null || String(id).trim() === '' ? this.#flightNumber : String(id).trim();
    this.#airline = airline ? String(airline).trim() : '';
    this.#fares = fares ? normaliseFares(fares, this.#flightNumber) : null;
    this.#originTimeZone = optionalZone(originTimeZone, 'The origin time zone');
    this.#destinationTimeZone = optionalZone(destinationTimeZone, 'The destination time zone');
    this.#initialiseSeatMap();
  }

  /**
   * Rows 1-2  : A-D -> FirstClassSeat (8)      Rows 3-5  : A-D -> BusinessSeat (12)
   * Rows 6-15 : A-F -> EconomySeat    (60)
   */
  #initialiseSeatMap() {
    const layout = [
      { rows: [1, 2],   cols: 'ABCD',   Seat: FirstClassSeat },
      { rows: [3, 5],   cols: 'ABCD',   Seat: BusinessSeat },
      { rows: [6, 15],  cols: 'ABCDEF', Seat: EconomySeat },
    ];
    for (const { rows: [from, to], cols, Seat } of layout) {
      for (let row = from; row <= to; row++) {
        for (const col of cols) {
          const number = `${row}${col}`;
          this.#seatMap.set(number, new Seat(number));
        }
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /** CANCELLED if cancelled, otherwise worked out from the time. `now` is passed in so it can be tested. */
  getStatus(now) {
    if (this.#cancelled) return FlightStatus.CANCELLED;
    if (now >= this.#departureTime) return FlightStatus.DEPARTED;
    if (now >= new Date(this.#departureTime.getTime() - BOARDING_WINDOW_MS)) return FlightStatus.BOARDING;
    return FlightStatus.SCHEDULED;
  }

  /** Marks the flight as cancelled. (Cancelling its bookings is the service's job.) */
  cancel() { this.#cancelled = true; }
  get isCancelled() { return this.#cancelled; }

  // ── Seats ─────────────────────────────────────────────────────────────────

  getSeat(seatNumber) { return this.#seatMap.get(seatNumber) ?? null; }

  /** All seats in layout order (first class first). */
  get seats() { return Array.from(this.#seatMap.values()); }

  /** Free seats in cabins that are actually on sale. */
  get availableSeats() { return this.seats.filter((seat) => !seat.isOccupied && this.offersClass(seat.seatClass)); }

  /** Seats that can be sold at all (every seat, minus cabins this flight does not sell). */
  get sellableSeats() { return this.seats.filter((seat) => this.offersClass(seat.seatClass)); }

  getAvailableSeatsByClass(seatClass) {
    return this.availableSeats.filter((seat) => seat.seatClass === seatClass);
  }

  /** { 'First Class': 6, Business: 10, Economy: 48 } - a class with no free seats is absent. */
  getAvailabilityByClass() {
    const counts = {};
    for (const seat of this.availableSeats) {
      counts[seat.seatClass] = (counts[seat.seatClass] ?? 0) + 1;
    }
    return counts;
  }

  hasAvailability() { return this.seats.some((seat) => !seat.isOccupied && this.offersClass(seat.seatClass)); }

  // ── Cabins and fares ──────────────────────────────────────────────────────

  /** Whether this flight sells the cabin. Flights without a fare table sell all three. */
  offersClass(seatClass) { return !this.#fares || this.#fares[seatClass] != null; }

  /** The cabins on sale, cheapest first. */
  get offeredClasses() { return CABINS.filter((cabin) => this.offersClass(cabin)); }

  /** The price of this seat before any discount or private suite, in pence - or null if the cabin is not sold. */
  baseFareFor(seat) {
    if (!this.offersClass(seat.seatClass)) return null;
    return this.#fares ? this.#fares[seat.seatClass] : seat.priceWith(false);
  }

  /** What each cabin costs on this flight (pence), null where not sold. Flights without a fare table use the standard seat prices. */
  get cabinFares() {
    if (this.#fares) return { ...this.#fares };
    const standard = {};
    for (const cabin of CABINS) standard[cabin] = this.seats.find((seat) => seat.seatClass === cabin)?.priceWith(false) ?? null;
    return standard;
  }

  /** The fare table this flight was created with (copy), or null for the standard prices. */
  get fares() { return this.#fares ? { ...this.#fares } : null; }

  /** Marks a seat as taken by someone who is not a registered passenger (gives flights a realistic load). */
  blockSeat(seatNumber) {
    const seat = this.#seatMap.get(seatNumber);
    if (!seat) throw new ValidationError(`Seat ${seatNumber} does not exist on ${this.#flightNumber}.`);
    seat.occupy(EXTERNAL_CUSTOMER);
    this.#externalSeats.add(seatNumber);
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  get id()            { return this.#id; }
  get flightNumber()  { return this.#flightNumber; }
  get airline()       { return this.#airline; }
  get originTimeZone()      { return this.#originTimeZone; }
  get destinationTimeZone() { return this.#destinationTimeZone; }
  get origin()        { return this.#origin; }
  get destination()   { return this.#destination; }
  get departureTime() { return this.#departureTime; }
  get arrivalTime()   { return this.#arrivalTime; }
  get totalSeats()    { return this.#seatMap.size; }
  get externalSeats() { return Array.from(this.#externalSeats).sort(); }

  // ── Local times (airport time when the zones are known, otherwise the browser's) ──────────

  /** Flight time in minutes. */
  get durationMinutes() { return Math.round((this.#arrivalTime - this.#departureTime) / 60000); }

  /** The calendar date of departure at the origin, "2027-01-15". */
  get departureDateKey() { return dateKeyOf(this.#departureTime, this.#originTimeZone); }

  /** "15 Jan 2027 08:05" at the origin. */
  get departureLabel() { return formatDateTimeIn(this.#departureTime, this.#originTimeZone); }

  /** "15 Jan 2027 10:20" at the destination. */
  get arrivalLabel() { return formatDateTimeIn(this.#arrivalTime, this.#destinationTimeZone); }

  /** "08:05" at the origin. */
  get departureClock() { return formatTimeIn(this.#departureTime, this.#originTimeZone); }

  /** "10:20" at the destination. */
  get arrivalClock() { return formatTimeIn(this.#arrivalTime, this.#destinationTimeZone); }

  toString() {
    return `${this.#flightNumber} | ${this.#origin} → ${this.#destination} | Dep: ${formatDateTime(this.#departureTime)}`;
  }
}
