import { CABINS } from './seat.js';

/**
 * Filtering and sorting of flight search results (ported from the Django project's search.js, which did this
 * by hiding DOM elements; here it is plain functions on the result list).
 *
 * A search result ("option") has: prices { cabin: pence | null }, departureHour / arrivalHour (local at each airport),
 * departureTime, arrivalTime, durationMinutes and airline.
 */

/** The four parts of the day used by the filters (same boundaries as the Django project). */
export const TIME_SLOTS = Object.freeze([
  Object.freeze({ id: 'early', label: 'Early morning', hint: 'Before 6 am', from: 0, to: 6 }),
  Object.freeze({ id: 'morning', label: 'Morning', hint: '6 am - noon', from: 6, to: 12 }),
  Object.freeze({ id: 'afternoon', label: 'Afternoon', hint: 'Noon - 6 pm', from: 12, to: 18 }),
  Object.freeze({ id: 'evening', label: 'Evening', hint: 'After 6 pm', from: 18, to: 24 }),
]);

export const slotOfHour = (hour) => TIME_SLOTS.find((s) => hour >= s.from && hour < s.to) ?? TIME_SLOTS[0];

export const SORTS = Object.freeze([
  Object.freeze({ id: 'price', label: 'Cheapest first' }),
  Object.freeze({ id: 'departure', label: 'Earliest departure' }),
  Object.freeze({ id: 'duration', label: 'Shortest flight' }),
  Object.freeze({ id: 'arrival', label: 'Earliest arrival' }),
]);

/** Lowest and highest price in the cabin among the options, or null when there are none. */
export function priceRange(options, cabin) {
  const prices = options.map((o) => o.prices[cabin]).filter((p) => p != null);
  return prices.length === 0 ? null : { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Airline names in the results, alphabetically. */
export function airlinesIn(options) {
  return [...new Set(options.map((o) => o.airline).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Keeps the options that match every filter that is set. Empty / null filters mean "anything".
 * `maxPrice` is in pence; `departSlots` / `arriveSlots` are lists of TIME_SLOTS ids; `airlines` a list of names.
 */
export function filterOptions(options, { cabin, maxPrice = null, departSlots = [], arriveSlots = [], airlines = [] }) {
  const inSlots = (hour, ids) => ids.length === 0 || ids.some((id) => {
    const slot = TIME_SLOTS.find((s) => s.id === id);
    return slot && hour >= slot.from && hour < slot.to;
  });
  return options.filter((o) => {
    const price = o.prices[cabin];
    return price != null
      && (maxPrice == null || price <= maxPrice)
      && inSlots(o.departureHour, departSlots)
      && inSlots(o.arrivalHour, arriveSlots)
      && (airlines.length === 0 || airlines.includes(o.airline));
  });
}

/** A sorted copy. Ties are broken by departure time so the order is stable. */
export function sortOptions(options, sortId, cabin) {
  const byDeparture = (a, b) => a.departureTime - b.departureTime;
  const keys = {
    price: (a, b) => (a.prices[cabin] ?? Infinity) - (b.prices[cabin] ?? Infinity),
    departure: byDeparture,
    duration: (a, b) => a.durationMinutes - b.durationMinutes,
    arrival: (a, b) => a.arrivalTime - b.arrivalTime,
  };
  const primary = keys[sortId] ?? keys.price;
  return [...options].sort((a, b) => primary(a, b) || byDeparture(a, b));
}

/** The shortest gap allowed between landing and taking off again on a return trip. */
export const MIN_TURNAROUND_MINUTES = 120;

/** Can the passenger actually make this return flight after the outbound one? */
export function isValidReturn(outbound, inbound, minGapMinutes = MIN_TURNAROUND_MINUTES) {
  return inbound.departureTime.getTime() - outbound.arrivalTime.getTime() >= minGapMinutes * 60000;
}

export const isCabin = (value) => CABINS.includes(value);
