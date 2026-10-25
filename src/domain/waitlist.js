/**
 * One first-come-first-served queue of WAITLISTED bookings per flight (keyed by Flight.id).
 * (Each entry is the Booking, not just the passenger, so promoting someone is a direct lookup.)
 */
export class WaitlistManager {
  #queues = new Map();   // flight id -> Booking[] in the order they joined

  add(booking) {
    const key = booking.flight.id;
    if (!this.#queues.has(key)) this.#queues.set(key, []);
    this.#queues.get(key).push(booking);
  }

  remove(booking) {
    const queue = this.#queues.get(booking.flight.id);
    if (!queue) return;
    const index = queue.indexOf(booking);
    if (index >= 0) queue.splice(index, 1);
  }

  /** Takes the booking at the front of the flight's queue, or null if nobody is waiting. */
  pollNext(flightId) {
    const queue = this.#queues.get(flightId);
    return queue && queue.length > 0 ? queue.shift() : null;
  }

  /** Empties a flight's queue (e.g. the flight was cancelled) and returns who was in it. */
  clear(flightId) {
    const queue = this.#queues.get(flightId) ?? [];
    this.#queues.delete(flightId);
    return [...queue];
  }

  bookingsFor(flightId) {
    return [...(this.#queues.get(flightId) ?? [])];
  }

  /** 1-based place in the flight's queue, or 0 if the passenger is not waiting. */
  positionOf(flightId, passenger) {
    return this.bookingsFor(flightId).findIndex((b) => b.passenger === passenger) + 1;
  }
}
