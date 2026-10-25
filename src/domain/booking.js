import { StateError } from './errors.js';
import { ZERO, format } from './money.js';

export const BookingStatus = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  CHECKED_IN: 'CHECKED_IN',
  WAITLISTED: 'WAITLISTED',
});

/**
 * One seat booking linking a Passenger to a Seat on a Flight.
 *
 * The fare is worked out once, when the booking is made (see PricingService) and stored here, so
 * later changes to prices or discount rules never change what an existing booking costs.
 * A WAITLISTED booking has no seat yet (seat is null) and costs nothing until it is confirmed.
 */
export class Booking {
  #bookingId; #passenger; #flight; #seat; #bookingTime; #status; #fare; #privateSuite; #reference;

  /**
   * Prefer Booking.confirmed(...) / Booking.waitlisted(...); the full form is also used to reload saved bookings.
   * `reference` is the short code printed on the ticket (e.g. "K7M2QX"). All the bookings made in one purchase
   * share it, so a family on a return trip is one reference but several bookings.
   */
  constructor(bookingId, passenger, flight, seat, bookingTime, status, fare, privateSuite, reference = null) {
    this.#bookingId = bookingId;
    this.#passenger = passenger;
    this.#flight = flight;
    this.#seat = seat ?? null;
    this.#bookingTime = bookingTime;
    this.#status = status;
    this.#fare = fare;
    this.#privateSuite = Boolean(privateSuite);
    this.#reference = reference || null;
  }

  static confirmed(bookingId, passenger, flight, seat, bookingTime, fare, privateSuite, reference = null) {
    return new Booking(bookingId, passenger, flight, seat, bookingTime, BookingStatus.CONFIRMED, fare, privateSuite, reference);
  }

  static waitlisted(bookingId, passenger, flight, bookingTime, reference = null) {
    return new Booking(bookingId, passenger, flight, null, bookingTime, BookingStatus.WAITLISTED, ZERO, false, reference);
  }

  /** The fare charged, in pence (0 while waitlisted). */
  calculateTotal() {
    return this.#status === BookingStatus.WAITLISTED ? ZERO : this.#fare;
  }

  /** "Booking #BK001 | LHR → JFK | Economy [12A] | £99.00 | CONFIRMED" */
  getReceipt() {
    const seatPart = this.#seat
      ? `${this.#seat.seatClass}${this.#privateSuite ? ' Suite' : ''} [${this.#seat.seatNumber}]`
      : 'Waitlisted (no seat yet)';
    return `Booking #${this.#bookingId} | ${this.#flight.origin} → ${this.#flight.destination} | ${seatPart} | ${format(this.calculateTotal())} | ${this.#status}`;
  }

  /** Cancels the booking and frees its seat (if it has one). */
  cancel() {
    if (this.#status === BookingStatus.CANCELLED) {
      throw new StateError(`Booking ${this.#bookingId} is already cancelled.`);
    }
    this.#status = BookingStatus.CANCELLED;
    if (this.#seat) this.#seat.vacate();
  }

  checkIn() {
    if (this.#status !== BookingStatus.CONFIRMED) {
      throw new StateError(`Only CONFIRMED bookings can be checked in (current status: ${this.#status}).`);
    }
    this.#status = BookingStatus.CHECKED_IN;
  }

  /** Gives a waitlisted booking the freed seat, records the fare and confirms it. */
  confirmFromWaitlist(freedSeat, fareForSeat) {
    if (this.#status !== BookingStatus.WAITLISTED) {
      throw new StateError(`Booking ${this.#bookingId} is not on the waitlist.`);
    }
    freedSeat.occupy(this.#passenger.fullName);
    this.#seat = freedSeat;
    this.#fare = fareForSeat;
    this.#privateSuite = false;
    this.#status = BookingStatus.CONFIRMED;
  }

  get bookingId()    { return this.#bookingId; }
  get passenger()    { return this.#passenger; }
  get flight()       { return this.#flight; }
  /** The seat, or null while WAITLISTED. */
  get seat()         { return this.#seat; }
  get bookingTime()  { return this.#bookingTime; }
  get status()       { return this.#status; }
  get hasPrivateSuite() { return this.#privateSuite; }
  /** The short booking reference shared by everything bought together, or null for very old saved bookings. */
  get reference()    { return this.#reference; }

  /** Only for old saved bookings that never had a reference: sets it once. Cannot change an existing one. */
  assignReference(reference) {
    if (this.#reference) throw new StateError(`Booking ${this.#bookingId} already has a reference.`);
    this.#reference = reference;
  }
  get isActive()     { return this.#status !== BookingStatus.CANCELLED; }

  toString() { return this.getReceipt(); }
}
