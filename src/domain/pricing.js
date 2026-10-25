import { percentOf } from './money.js';
import { daysBetween } from './dates.js';
import { ValidationError } from './errors.js';

export const EARLY_BIRD_DAYS = 60;
export const EARLY_BIRD_PERCENT_PAID = 90;   // i.e. 10% off

/**
 * The one place that decides what a seat costs, so new rules (taxes, promo codes, dynamic fares)
 * can be added here without touching anything else.
 *
 * Current rules:
 *   - the flight's fare for the seat's cabin (a flight from the schedule has its own fares; any other flight
 *     uses the standard seat prices), plus the First Class private suite surcharge if chosen
 *   - early bird: 10% off when booked MORE than 60 days before departure
 */
export class PricingService {
  /** What the seat costs before any discount, in pence. @throws ValidationError if the flight does not sell that cabin */
  listPriceFor(flight, seat, privateSuite) {
    const base = flight.baseFareFor(seat);
    if (base == null) {
      throw new ValidationError(`${seat.seatClass} is not sold on flight ${flight.flightNumber}.`);
    }
    return base + (privateSuite ? seat.suiteSurcharge : 0);
  }

  /** @returns the price in pence, with the early-bird discount if it applies */
  priceFor(flight, seat, privateSuite, bookingTime) {
    return this.priceForFare(this.listPriceFor(flight, seat, privateSuite), flight.departureTime, bookingTime);
  }

  /** The same rules applied to a plain fare - used to show prices in search results before any seat is chosen. */
  priceForFare(farePence, departureTime, bookingTime) {
    return daysBetween(bookingTime, departureTime) > EARLY_BIRD_DAYS
      ? percentOf(farePence, EARLY_BIRD_PERCENT_PAID)
      : farePence;
  }
}
