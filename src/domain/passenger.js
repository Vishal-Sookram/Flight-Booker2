import { ValidationError } from './errors.js';
import { ZERO, format } from './money.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[\d\s\-().]+$/;

/**
 * A passenger. Validation lives in the setters, so a Passenger can never start out invalid.
 * Implements the "Payable" idea from the lab: calculateTotal() and getReceipt().
 */
export class Passenger {
  #passengerId; #fullName; #email; #passportNumber; #phone = '';
  #bookings = [];

  constructor(passengerId, fullName, email, passportNumber, phone = '') {
    if (!passengerId || String(passengerId).trim() === '') {
      throw new ValidationError('Passenger id is required.');
    }
    if (!passportNumber || String(passportNumber).trim() === '') {
      throw new ValidationError('Passport number is required.');
    }
    this.#passengerId = passengerId;
    this.#passportNumber = String(passportNumber).trim().toUpperCase();
    this.fullName = fullName;
    this.email = email;
    this.phone = phone;
  }

  // ── Bookings ──────────────────────────────────────────────────────────────
  addBooking(booking) {
    if (!booking) throw new ValidationError('Booking cannot be null.');
    this.#bookings.push(booking);
  }

  /** Removes a booking by id. Returns true if it was found and removed. */
  cancelBooking(bookingId) {
    const index = this.#bookings.findIndex((b) => b.bookingId === bookingId);
    if (index < 0) return false;
    this.#bookings.splice(index, 1);
    return true;
  }

  /** A read-only copy, so callers cannot change the passenger's list directly. */
  get bookings() { return Object.freeze([...this.#bookings]); }

  // ── Payable ───────────────────────────────────────────────────────────────
  calculateTotal() {
    return this.#bookings.reduce((sum, b) => sum + b.calculateTotal(), ZERO);
  }

  getReceipt() {
    const line = '-'.repeat(64);
    const rows = this.#bookings.length === 0
      ? ['(no active bookings)']
      : this.#bookings.map((b) => b.getReceipt());
    return [
      `Passenger: ${this.#fullName} (${this.#passengerId})`,
      line,
      ...rows,
      line,
      `Grand Total: ${format(this.calculateTotal())}`,
    ].join('\n');
  }

  // ── Getters & validated setters ───────────────────────────────────────────
  get passengerId()    { return this.#passengerId; }
  get passportNumber() { return this.#passportNumber; }
  get fullName()       { return this.#fullName; }
  get email()          { return this.#email; }
  get phone()          { return this.#phone; }

  set fullName(value) {
    if (value == null || String(value).trim() === '') throw new ValidationError('Name cannot be empty.');
    this.#fullName = String(value).trim();
  }

  set email(value) {
    if (value == null || !EMAIL.test(String(value).trim())) {
      throw new ValidationError('Please enter a valid email address (e.g. name@example.com).');
    }
    this.#email = String(value).trim();
  }

  /** Optional (carried over from the original AirNest form). Blank is fine; otherwise 7-15 digits. */
  set phone(value) {
    const text = value == null ? '' : String(value).trim();
    if (text !== '') {
      const digits = text.replace(/\D/g, '').length;
      if (!PHONE.test(text) || digits < 7 || digits > 15) {
        throw new ValidationError('Please enter a valid phone number (7-15 digits), or leave it blank.');
      }
    }
    this.#phone = text;
  }

  toString() {
    return `${this.#fullName} (${this.#passengerId}) — ${this.#bookings.length} booking(s)`;
  }
}
