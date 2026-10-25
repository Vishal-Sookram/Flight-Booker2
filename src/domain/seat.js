import { StateError } from './errors.js';
import { pounds, format } from './money.js';

/** The three cabins, cheapest first. These exact strings are what Seat.seatClass returns. */
export const SeatClass = Object.freeze({ ECONOMY: 'Economy', BUSINESS: 'Business', FIRST: 'First Class' });
export const CABINS = Object.freeze([SeatClass.ECONOMY, SeatClass.BUSINESS, SeatClass.FIRST]);

/**
 * Abstract base class for a seat (ported from the Java lab).
 * Subclasses: EconomySeat, BusinessSeat, FirstClassSeat.
 *
 * OOP concepts: abstraction, inheritance, polymorphism, encapsulation (# fields are truly private).
 */
export class Seat {
  #seatNumber;                 // e.g. "12A"
  #occupied = false;
  #passengerName = null;

  constructor(seatNumber) {
    if (new.target === Seat) {
      throw new TypeError('Seat is abstract - create an EconomySeat, BusinessSeat or FirstClassSeat.');
    }
    this.#seatNumber = seatNumber;
  }

  // ── Abstract members (each subclass defines its own) ──────────────────────
  get basePrice()  { throw new Error('basePrice must be implemented by the subclass'); }
  get seatClass()  { throw new Error('seatClass must be implemented by the subclass'); }
  get perks()      { throw new Error('perks must be implemented by the subclass'); }

  // ── Overridable hooks (defaults suit most seat types) ─────────────────────
  get supportsPrivateSuite() { return false; }

  /** Extra charge for the optional private suite (0 unless the seat supports one). */
  get suiteSurcharge() { return 0; }

  /** Price if the optional private suite is chosen (ignored unless the seat supports one). */
  priceWith(/* privateSuite */) { return this.basePrice; }

  // ── Behaviour ─────────────────────────────────────────────────────────────
  occupy(name) {
    if (this.#occupied) {
      throw new StateError(`Seat ${this.#seatNumber} is already occupied.`);
    }
    this.#occupied = true;
    this.#passengerName = name;
  }

  vacate() {
    this.#occupied = false;
    this.#passengerName = null;
  }

  get seatNumber()    { return this.#seatNumber; }
  get isOccupied()    { return this.#occupied; }
  get passengerName() { return this.#passengerName; }

  toString() {
    const state = this.#occupied ? `Occupied: ${this.#passengerName}` : 'Available';
    return `[${this.#seatNumber}] ${this.seatClass} — ${format(this.basePrice)} (${state})`;
  }
}

export class EconomySeat extends Seat {
  get basePrice() { return pounds(99); }
  get seatClass() { return SeatClass.ECONOMY; }
  get perks()     { return '1 carry-on bag, complimentary snack'; }
}

export class BusinessSeat extends Seat {
  get basePrice() { return pounds(349); }
  get seatClass() { return SeatClass.BUSINESS; }
  get perks()     { return '2 checked bags, hot meal, priority boarding, lounge access'; }
}

export class FirstClassSeat extends Seat {
  static BASE_PRICE = pounds(799);
  static SUITE_SURCHARGE = pounds(200);

  #privateSuite = false;

  get basePrice() {
    return this.#privateSuite ? FirstClassSeat.BASE_PRICE + FirstClassSeat.SUITE_SURCHARGE : FirstClassSeat.BASE_PRICE;
  }
  get seatClass() { return SeatClass.FIRST; }
  get perks()     { return '3 checked bags, gourmet dining, flat bed, private suite, chauffeur'; }

  get supportsPrivateSuite() { return true; }
  get suiteSurcharge() { return FirstClassSeat.SUITE_SURCHARGE; }

  priceWith(withSuite) {
    return withSuite ? FirstClassSeat.BASE_PRICE + FirstClassSeat.SUITE_SURCHARGE : FirstClassSeat.BASE_PRICE;
  }

  get hasPrivateSuite() { return this.#privateSuite; }

  /** The suite option cannot change on an occupied seat: that would silently change an existing booking. */
  setPrivateSuite(value) {
    if (this.isOccupied) {
      throw new StateError(`Cannot change the suite option on an occupied seat (${this.seatNumber}).`);
    }
    this.#privateSuite = Boolean(value);
  }

  /** Freeing a first-class seat also resets the suite option, so the next passenger starts from standard. */
  vacate() {
    super.vacate();
    this.#privateSuite = false;
  }
}
