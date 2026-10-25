import { ValidationError, StateError } from './errors.js';
import { Flight, FlightStatus } from './flight.js';
import { CABINS, FirstClassSeat } from './seat.js';
import { Passenger } from './passenger.js';
import { Booking, BookingStatus } from './booking.js';
import { PricingService } from './pricing.js';
import { WaitlistManager } from './waitlist.js';
import { IdGenerator } from './idGenerator.js';
import { toDateInputValue } from './dates.js';
import { addDaysToDateKey, wallClock } from './timezones.js';
import { bookingsToCsv } from './csv.js';
import { seedDemoData } from './demoData.js';
import { flightFromOffer } from './schedule.js';
import { applyDemand } from './load.js';
import { generateReference, normaliseReference } from './reference.js';

/** Same key as before: saves made by earlier versions are still found (and understood - see #restore). */
export const STORAGE_KEY = 'airnest.data.v1';
const SAVE_VERSION = 2;

export const MAX_PASSENGERS = 9;
export const MAX_LEGS = 2;

/**
 * The single point of contact between the screens and the data model (ported from the Java lab's
 * BookingService). It enforces the business rules and coordinates the helpers:
 *
 *   PricingService   what things cost            WaitlistManager   who is waiting for a seat
 *   IdGenerator      PAX-001 / BK001 ids         csv.js            CSV export
 *
 * React screens subscribe through subscribe()/getVersion() (the Observer pattern) and re-render
 * whenever anything changes. Data is saved to `storage` (localStorage in the browser) after every
 * change and reloaded on the next visit.
 *
 * Money is in pence (whole numbers). Times come from the injected `now()` so tests can control them.
 */
export class BookingService {
  #now; #storage; #storageKey;
  #flights = new Map();         // flightNumber -> Flight
  #passengers = new Map();      // passengerId  -> Passenger
  #bookings = new Map();        // bookingId    -> Booking
  #waitlist = new WaitlistManager();
  #pricing = new PricingService();
  #passengerIds = new IdGenerator('PAX-', 3);
  #bookingIds = new IdGenerator('BK', 3);
  #listeners = new Set();
  #version = 0;
  #quiet = 0;                   // > 0 while seeding, so we only save/notify once at the end
  #random;
  #references = new Set();      // every booking reference in use
  #previews = new Map();        // flight id -> not-yet-booked flight shown in search results

  /**
   * @param now       function returning the current Date
   * @param storage   anything with getItem/setItem/removeItem (e.g. window.localStorage), or null
   * @param seedDemo  start with demo data when there is nothing saved
   * @param random    function returning a number in [0, 1) - used for booking references (a test can fix it)
   */
  constructor({ now = () => new Date(), storage = null, storageKey = STORAGE_KEY, seedDemo = true, random = Math.random } = {}) {
    this.#now = now;
    this.#storage = storage;
    this.#storageKey = storageKey;
    this.#random = random;
    const loaded = this.#load();
    if (!loaded && seedDemo) {
      this.#seed();
    } else if (loaded && this.#giveMissingReferences()) {
      this.#save();                                    // very old saves had no references: now they do, and it sticks
    }
  }

  // ── Change notification (Observer pattern) ────────────────────────────────

  /** Registers a function to run after every change. Returns a function that unregisters it. */
  subscribe = (listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Increases after every change (React's useSyncExternalStore uses this to know when to re-render). */
  getVersion = () => this.#version;

  #changed() {
    if (this.#quiet > 0) return;
    this.#version++;
    this.#save();
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (e) {
        console.error('A change listener failed', e);   // one broken screen must not stop a booking
      }
    }
  }

  // ── Flights ───────────────────────────────────────────────────────────────

  /**
   * Adds a flight. Optional extras: `id`, `airline`, `fares`, `originTimeZone`, `destinationTimeZone` (see Flight).
   * @throws ValidationError if details are invalid or the number is taken.
   */
  addFlight({ flightNumber, origin, destination, departureTime, arrivalTime, ...options }) {
    const flight = new Flight(flightNumber, origin, destination, departureTime, arrivalTime, options);
    if (this.#flights.has(flight.id)) {
      throw new ValidationError(`Flight ${flight.flightNumber} already exists.`);
    }
    this.#flights.set(flight.id, flight);
    this.#changed();
    return flight;
  }

  /** All flights, earliest departure first. */
  getAllFlights() {
    return [...this.#flights.values()].sort((a, b) => a.departureTime - b.departureTime);
  }

  /** Looks a flight up by id (for flights added by hand, the id is the flight number). */
  getFlight(flightId) {
    return this.#flights.get(flightId) ?? null;
  }

  /**
   * Searches flights. A blank origin / destination / date means "any".
   * Origin and destination are matched case-insensitively; `date` is "YYYY-MM-DD" (or a Date).
   */
  searchFlights({ origin = '', destination = '', date = null } = {}) {
    const o = origin.trim().toUpperCase();
    const d = destination.trim().toUpperCase();
    const day = !date ? null : (date instanceof Date ? toDateInputValue(date) : date);
    return this.getAllFlights().filter((f) =>
      (o === '' || f.origin === o)
      && (d === '' || f.destination === d)
      && (day === null || f.departureDateKey === day));
  }

  getFlightStatus(flight) { return flight.getStatus(this.#now()); }
  isBookable(flight)      { return this.getFlightStatus(flight).bookable; }

  /**
   * Cancels a whole flight: every active booking on it (including waitlisted ones) is cancelled
   * and its seat freed, and the waitlist is emptied.
   * @returns how many bookings were cancelled
   */
  cancelFlight(flightId) {
    const flight = this.#requireFlight(flightId);
    const status = this.getFlightStatus(flight);
    if (status === FlightStatus.DEPARTED || status === FlightStatus.CANCELLED) {
      throw new StateError(`Flight ${flight.flightNumber} is already ${status.label.toLowerCase()}.`);
    }
    flight.cancel();
    this.#waitlist.clear(flight.id);

    let cancelled = 0;
    for (const booking of this.getAllBookings()) {
      if (booking.flight === flight && booking.isActive) {
        booking.cancel();
        booking.passenger.cancelBooking(booking.bookingId);
        cancelled++;
      }
    }
    this.#changed();
    return cancelled;
  }

  // ── Passengers ────────────────────────────────────────────────────────────

  /** All passengers, ordered by id. */
  getAllPassengers() {
    return [...this.#passengers.values()].sort((a, b) => a.passengerId.localeCompare(b.passengerId));
  }

  getPassenger(passengerId) {
    return this.#passengers.get(passengerId) ?? null;
  }

  /**
   * Registers a passenger with the next free id (PAX-006, PAX-007, ...).
   * @throws ValidationError if a field is invalid or the passport is already registered
   */
  registerPassenger({ fullName, email, passport, phone = '' }) {
    if (!fullName?.trim() || !email?.trim() || !passport?.trim()) {
      throw new ValidationError('Name, email and passport are all required.');
    }
    const normalised = passport.trim().toUpperCase();
    const existing = this.getAllPassengers().find((p) => p.passportNumber === normalised);
    if (existing) {
      throw new ValidationError(`Passport ${normalised} is already registered to ${existing.passengerId}.`);
    }
    const passenger = new Passenger(this.#passengerIds.peek(), fullName, email, passport, phone);   // validates
    this.#passengers.set(passenger.passengerId, passenger);
    this.#passengerIds.observe(passenger.passengerId);
    this.#changed();
    return passenger;
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  /** What this seat would cost now (including any early-bird discount), in pence. Changes nothing. */
  quote(flight, seat, privateSuite = false) {
    return this.#pricing.priceFor(flight, seat, privateSuite && seat.supportsPrivateSuite, this.#now());
  }

  /** What this seat costs before any discount, in pence (for showing a crossed-out price). */
  listPrice(flight, seat, privateSuite = false) {
    return this.#pricing.listPriceFor(flight, seat, privateSuite && seat.supportsPrivateSuite);
  }

  /**
   * Books a seat. If the flight is completely full the passenger is waitlisted instead, and a
   * WAITLISTED booking is returned.
   *
   * @param options  { reference } - the booking reference to use (a new one is made if omitted)
   * @throws ValidationError if the passenger, flight or seat does not exist, or a suite is asked for on a seat without one
   * @throws StateError      if the flight is closed, the passenger already has a booking on it, or the seat is taken
   */
  createBooking(passengerId, flightId, seatNumber, privateSuite = false, options = {}) {
    const passenger = this.#requirePassenger(passengerId);
    const flight = this.#requireFlight(flightId);
    this.#requireBookable(flight);
    this.#requireNoActiveBooking(passenger, flight);

    const reference = options.reference ? normaliseReference(options.reference) : this.#newReference();
    if (!flight.hasAvailability()) {
      return this.#enqueue(passenger, flight, reference);
    }

    const seat = this.#requireFreeSeat(flight, seatNumber, privateSuite);
    const booking = this.#book(passenger, flight, seat, privateSuite, reference);
    this.#changed();
    return booking;
  }

  /** The checks every seat must pass before it is sold: it exists, its cabin is on sale, it is free, a suite is allowed. */
  #requireFreeSeat(flight, seatNumber, privateSuite) {
    const seat = flight.getSeat(seatNumber);
    if (!seat) throw new ValidationError(`Seat ${seatNumber} does not exist on flight ${flight.flightNumber}.`);
    if (!flight.offersClass(seat.seatClass)) {
      throw new ValidationError(`${seat.seatClass} is not sold on flight ${flight.flightNumber}.`);
    }
    if (seat.isOccupied) throw new StateError(`Seat ${seatNumber} is already taken.`);
    if (privateSuite && !seat.supportsPrivateSuite) {
      throw new ValidationError('Private suites are only available in First Class.');
    }
    return seat;
  }

  /** Does the actual booking (all checks have already passed). Does not notify. */
  #book(passenger, flight, seat, privateSuite, reference) {
    const when = this.#now();
    const fare = this.#pricing.priceFor(flight, seat, privateSuite, when);
    if (privateSuite && seat instanceof FirstClassSeat) {
      seat.setPrivateSuite(true);              // must be set before the seat is occupied
    }
    seat.occupy(passenger.fullName);
    const booking = Booking.confirmed(this.#bookingIds.peek(), passenger, flight, seat, when, fare, privateSuite, reference);
    this.#addBooking(booking);
    passenger.addBooking(booking);
    return booking;
  }

  /** Puts a passenger on the waitlist of a full flight. */
  joinWaitlist(passengerId, flightId) {
    const passenger = this.#requirePassenger(passengerId);
    const flight = this.#requireFlight(flightId);
    this.#requireBookable(flight);
    if (flight.hasAvailability()) {
      throw new StateError(`Flight ${flight.flightNumber} still has seats available - book a seat instead.`);
    }
    this.#requireNoActiveBooking(passenger, flight);
    return this.#enqueue(passenger, flight, this.#newReference());
  }

  #enqueue(passenger, flight, reference) {
    const booking = Booking.waitlisted(this.#bookingIds.peek(), passenger, flight, this.#now(), reference);
    this.#addBooking(booking);
    passenger.addBooking(booking);
    this.#waitlist.add(booking);
    this.#changed();
    return booking;
  }

  /**
   * Cancels a booking and frees its seat. If the flight has a waitlist, the first person waiting
   * is automatically given the freed seat.
   *
   * @returns { booking, promoted } - `promoted` is the waitlisted booking that was confirmed (or null);
   *          or null if there is no booking with that id
   * @throws StateError if it is already cancelled or the flight has already departed
   */
  cancelBooking(bookingId) {
    const booking = this.#bookings.get(bookingId);
    if (!booking) return null;

    const flight = booking.flight;
    if (this.getFlightStatus(flight) === FlightStatus.DEPARTED) {
      throw new StateError(`Flight ${flight.flightNumber} has already departed - the booking can no longer be cancelled.`);
    }

    const wasWaitlisted = booking.status === BookingStatus.WAITLISTED;
    const freedSeat = booking.seat;

    booking.cancel();                                   // throws if already cancelled
    booking.passenger.cancelBooking(bookingId);

    let promoted = null;
    if (wasWaitlisted) {
      this.#waitlist.remove(booking);
    } else if (freedSeat) {
      const next = this.#waitlist.pollNext(flight.id);
      if (next) {
        next.confirmFromWaitlist(freedSeat, this.#pricing.priceFor(flight, freedSeat, false, this.#now()));
        promoted = next;
      }
    }
    this.#changed();
    return { booking, promoted };
  }

  /** Checks a CONFIRMED booking in (not possible once the flight has departed or been cancelled). */
  checkIn(bookingId) {
    const booking = this.#bookings.get(bookingId);
    if (!booking) throw new ValidationError(`Booking not found: ${bookingId}`);
    const status = this.getFlightStatus(booking.flight);
    if (status === FlightStatus.DEPARTED || status === FlightStatus.CANCELLED) {
      throw new StateError(`Flight ${booking.flight.flightNumber} is ${status.label.toLowerCase()} - check-in is closed.`);
    }
    booking.checkIn();
    this.#changed();
    return booking;
  }

  /** Passengers waiting for a seat on this flight, in queue order. */
  getWaitlist(flightId) {
    return this.#waitlist.bookingsFor(flightId).map((b) => b.passenger);
  }

  /** 1-based position in the flight's waitlist, or 0 if the passenger is not waiting. */
  getWaitlistPosition(flightId, passenger) {
    return this.#waitlist.positionOf(flightId, passenger);
  }

  /** All bookings (including cancelled ones) for one passenger, ordered by id. */
  getBookingsForPassenger(passengerId) {
    return this.getAllBookings().filter((b) => b.passenger.passengerId === passengerId);
  }

  getAllBookings() {
    return [...this.#bookings.values()].sort((a, b) => a.bookingId.localeCompare(b.bookingId));
  }

  hasActiveBooking(passenger, flight) {
    return passenger.bookings.some((b) => b.flight === flight && b.isActive);
  }

  // ── Schedule flights, search and group reservations ───────────────────────

  /**
   * Searches the schedule (plus any flights added by hand) for one day. Each result ("option") has everything a
   * results page needs: times at each airport, the price of every cabin (early bird included), how many seats are
   * left, and the real Flight. Only flights that can still be booked are returned.
   *
   * Nothing is created by searching. A flight from the schedule only becomes part of the system when someone
   * picks it - see ensureFlight().
   *
   * @param catalog  a ScheduleCatalog, or null to search only the flights already here
   * @param cabin    if given, only flights that sell this cabin are returned
   */
  searchOptions(catalog, { origin, destination, date, cabin = null }) {
    const o = String(origin ?? '').trim().toUpperCase();
    const d = String(destination ?? '').trim().toUpperCase();
    const flights = [];
    const seen = new Set();
    for (const offer of catalog ? catalog.offersFor({ origin: o, destination: d, date }) : []) {
      seen.add(offer.id);
      flights.push(this.#flights.get(offer.id) ?? this.#preview(offer));
    }
    for (const f of this.getAllFlights()) {
      if (!seen.has(f.id) && f.origin === o && f.destination === d && f.departureDateKey === date) flights.push(f);
    }
    return flights
      .map((flight) => this.#toOption(flight))
      .filter((option) => option.status.bookable && (cabin == null || option.prices[cabin] != null))
      .sort((a, b) => a.departureTime - b.departureTime || a.flightNumber.localeCompare(b.flightNumber));
  }

  /** Cheapest price in the cabin on each of `days` days from `startDate`: [{ date, price | null }] (for a "flexible dates" strip). */
  cheapestByDate(catalog, { origin, destination, cabin, startDate, days = 7 }) {
    const result = [];
    for (let i = 0; i < days; i++) {
      const date = addDaysToDateKey(startDate, i);
      const prices = this.searchOptions(catalog, { origin, destination, date, cabin }).map((opt) => opt.prices[cabin]);
      result.push({ date, price: prices.length ? Math.min(...prices) : null });
    }
    return result;
  }

  /**
   * Makes a search result part of the system so it can be booked (once; asking again returns the same flight).
   * Accepts an option from searchOptions(). The flight keeps the "other customers" it was shown with.
   */
  ensureFlight(option) {
    const existing = this.#flights.get(option.id);
    if (existing) return existing;
    this.#flights.set(option.flight.id, option.flight);
    this.#previews.delete(option.flight.id);
    this.#changed();
    return option.flight;
  }

  /** A flight from the schedule as it would be if it were created now, kept so search results stay stable. */
  #preview(offer) {
    let flight = this.#previews.get(offer.id);
    if (!flight) {
      if (this.#previews.size > 400) this.#previews.clear();
      flight = flightFromOffer(offer);
      applyDemand(flight);
      this.#previews.set(offer.id, flight);
    }
    return flight;
  }

  #toOption(flight) {
    const when = this.#now();
    const listPrices = flight.cabinFares;
    const prices = {};
    for (const cabin of CABINS) {
      prices[cabin] = listPrices[cabin] == null ? null : this.#pricing.priceForFare(listPrices[cabin], flight.departureTime, when);
    }
    const availability = flight.getAvailabilityByClass();
    return {
      id: flight.id,
      flight,
      materialized: this.#flights.get(flight.id) === flight,
      flightNumber: flight.flightNumber,
      airline: flight.airline,
      origin: flight.origin,
      destination: flight.destination,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      durationMinutes: flight.durationMinutes,
      departureHour: wallClock(flight.departureTime, flight.originTimeZone).hour,
      arrivalHour: wallClock(flight.arrivalTime, flight.destinationTimeZone).hour,
      status: flight.getStatus(when),
      listPrices,
      prices,
      availability,
      seatsLeft: Object.values(availability).reduce((sum, n) => sum + n, 0),
    };
  }

  /**
   * Books several passengers on one or two flights (outbound and return) in a single all-or-nothing step.
   * Everything is checked first; if anything is wrong nothing at all is changed.
   *
   * @param passengers  one entry per traveller: { passengerId } for someone already registered, or
   *                    { details: { fullName, email, passport, phone } } for a new person (registered as part of this step)
   * @param legs        one entry per flight: { flightId, seats: [{ seatNumber, privateSuite? }, ...] } - seats[i] is for passengers[i]
   * @returns { reference, bookings, total }   all the bookings share the one reference
   */
  createReservation(request) {
    const { people, plan } = this.#planReservation(request);
    return this.#carryOutReservation(people, plan);
  }

  /**
   * Runs every check createReservation() would, and changes nothing. Checkout uses it to confirm the seats are still
   * available BEFORE taking payment. @throws ValidationError | StateError exactly as createReservation does
   */
  checkReservation(request) {
    this.#planReservation(request);
    return true;
  }

  /** All the checks. Returns who is travelling and which seats on which flights - changes nothing. */
  #planReservation({ passengers, legs }) {
    if (!Array.isArray(passengers) || passengers.length === 0) throw new ValidationError('Add at least one passenger.');
    if (passengers.length > MAX_PASSENGERS) throw new ValidationError(`A reservation can have at most ${MAX_PASSENGERS} passengers.`);
    if (!Array.isArray(legs) || legs.length === 0 || legs.length > MAX_LEGS) {
      throw new ValidationError(`A reservation needs one or two flights.`);
    }

    // 1. Who is travelling. Existing passengers are looked up; new ones are only checked for now.
    const people = [];
    const usedIds = new Set();
    const usedPassports = new Set();
    for (const entry of passengers) {
      if (entry.passengerId) {
        const passenger = this.#requirePassenger(entry.passengerId);
        if (usedIds.has(passenger.passengerId)) throw new ValidationError(`${passenger.fullName} is listed twice.`);
        usedIds.add(passenger.passengerId);
        people.push({ passenger });
      } else {
        const details = entry.details ?? {};
        this.validateNewPassenger(details);
        const passport = details.passport.trim().toUpperCase();
        if (usedPassports.has(passport)) throw new ValidationError(`Passport ${passport} is entered twice.`);
        usedPassports.add(passport);
        people.push({ details });
      }
    }

    // 2. Which flights and seats.
    const plan = [];
    const usedFlights = new Set();
    for (const leg of legs) {
      const flight = this.#requireFlight(leg.flightId);
      if (usedFlights.has(flight.id)) throw new ValidationError(`Flight ${flight.flightNumber} is listed twice.`);
      usedFlights.add(flight.id);
      this.#requireBookable(flight);
      if (!Array.isArray(leg.seats) || leg.seats.length !== people.length) {
        throw new ValidationError(`Choose one seat per passenger on flight ${flight.flightNumber}.`);
      }
      const usedSeats = new Set();
      const picks = leg.seats.map((choice, i) => {
        const suite = Boolean(choice.privateSuite);
        const seat = this.#requireFreeSeat(flight, choice.seatNumber, suite);
        if (usedSeats.has(seat.seatNumber)) throw new ValidationError(`Seat ${seat.seatNumber} is chosen twice on flight ${flight.flightNumber}.`);
        usedSeats.add(seat.seatNumber);
        if (people[i].passenger) this.#requireNoActiveBooking(people[i].passenger, flight);
        return { seat, suite };
      });
      plan.push({ flight, picks });
    }
    return { people, plan };
  }

  /** Makes the bookings for a checked plan. If anything unexpected goes wrong half-way, undoes what was done. */
  #carryOutReservation(people, plan) {
    this.#quiet++;
    const registered = [];
    const created = [];
    const reference = this.#newReference();
    try {
      const travellers = people.map((p) => {
        if (p.passenger) return p.passenger;
        const fresh = this.registerPassenger(p.details);
        registered.push(fresh);
        return fresh;
      });
      for (const { flight, picks } of plan) {
        picks.forEach(({ seat, suite }, i) => created.push(this.#book(travellers[i], flight, seat, suite, reference)));
      }
    } catch (error) {
      for (const booking of created) this.#discard(booking);
      for (const passenger of registered) this.#passengers.delete(passenger.passengerId);
      throw error;
    } finally {
      this.#quiet--;
    }
    this.#changed();
    return { reference, bookings: created, total: created.reduce((sum, b) => sum + b.calculateTotal(), 0) };
  }

  /** Removes a booking that was only just made (used to undo a failed reservation). */
  #discard(booking) {
    booking.seat?.vacate();
    this.#bookings.delete(booking.bookingId);
    booking.passenger.cancelBooking(booking.bookingId);
    this.#references.delete(booking.reference);
  }

  /** Checks details for a new passenger without registering anyone. @throws ValidationError */
  validateNewPassenger({ fullName, email, passport, phone = '' }) {
    if (!fullName?.trim() || !email?.trim() || !passport?.trim()) {
      throw new ValidationError('Name, email and passport are all required.');
    }
    const normalised = passport.trim().toUpperCase();
    const existing = this.getAllPassengers().find((p) => p.passportNumber === normalised);
    if (existing) throw new ValidationError(`Passport ${normalised} is already registered to ${existing.passengerId}.`);
    new Passenger('CHECK', fullName, email, passport, phone);          // throws if the name, email or phone is invalid
  }

  /** Everything bought under one booking reference (any case), or null if there is no such reference. */
  getReservation(reference) {
    const ref = normaliseReference(reference);
    const bookings = this.getAllBookings().filter((b) => b.reference === ref);
    if (bookings.length === 0) return null;
    const flights = [...new Map(bookings.map((b) => [b.flight.id, b.flight])).values()].sort((a, b) => a.departureTime - b.departureTime);
    const passengers = [...new Map(bookings.map((b) => [b.passenger.passengerId, b.passenger])).values()];
    return {
      reference: ref,
      bookings,
      flights,
      passengers,
      total: bookings.filter((b) => b.isActive).reduce((sum, b) => sum + b.calculateTotal(), 0),
      isActive: bookings.some((b) => b.isActive),
    };
  }

  /**
   * Cancels every booking under a reference that can still be cancelled (not those on flights that have departed).
   * @returns { cancelled: Booking[], failed: [{ booking, reason }], promoted: Booking[] }  (null if no such reference)
   */
  cancelReservation(reference) {
    const reservation = this.getReservation(reference);
    if (!reservation) return null;
    const outcome = { cancelled: [], failed: [], promoted: [] };
    this.#quiet++;
    try {
      for (const booking of reservation.bookings.filter((b) => b.isActive)) {
        try {
          const { promoted } = this.cancelBooking(booking.bookingId);
          outcome.cancelled.push(booking);
          if (promoted) outcome.promoted.push(promoted);
        } catch (error) {
          outcome.failed.push({ booking, reason: error.message });
        }
      }
    } finally {
      this.#quiet--;
    }
    if (outcome.cancelled.length > 0) this.#changed();
    return outcome;
  }

  /** Headline numbers for the staff screen. Revenue counts confirmed and checked-in bookings only. */
  getStats() {
    const bookings = this.getAllBookings();
    const byStatus = {};
    for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    const paying = bookings.filter((b) => b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.CHECKED_IN);
    const flights = this.getAllFlights();
    return {
      flights: flights.length,
      upcomingFlights: flights.filter((f) => this.isBookable(f)).length,
      passengers: this.#passengers.size,
      bookings: bookings.length,
      byStatus,
      seatsSold: paying.length,
      revenue: paying.reduce((sum, b) => sum + b.calculateTotal(), 0),
    };
  }

  /** Gives every booking that has no reference one (only old saved data lacks them). Returns true if any were given. */
  #giveMissingReferences() {
    let changed = false;
    for (const booking of this.getAllBookings()) {
      if (!booking.reference) {
        booking.assignReference(this.#newReference());
        this.#references.add(booking.reference);
        changed = true;
      }
    }
    return changed;
  }

  // ── Data management ───────────────────────────────────────────────────────

  exportBookingsCsv() {
    return bookingsToCsv(this.getAllBookings());
  }

  /** Throws away everything and starts again from the demo data. */
  resetDemoData() {
    this.#clearAll();
    this.#seed();
  }

  #clearAll() {
    this.#flights = new Map();
    this.#passengers = new Map();
    this.#bookings = new Map();
    this.#waitlist = new WaitlistManager();
    this.#passengerIds = new IdGenerator('PAX-', 3);
    this.#bookingIds = new IdGenerator('BK', 3);
    this.#references = new Set();
    this.#previews = new Map();
  }

  #seed() {
    this.#quiet++;
    try {
      seedDemoData({ service: this, now: this.#now() });
    } finally {
      this.#quiet--;
    }
    this.#changed();
  }

  // ── Validation helpers ────────────────────────────────────────────────────

  #requirePassenger(id) {
    const passenger = this.#passengers.get(id);
    if (!passenger) throw new ValidationError(`Passenger not found: ${id}`);
    return passenger;
  }

  #requireFlight(flightId) {
    const flight = this.#flights.get(flightId);
    if (!flight) throw new ValidationError(`Flight not found: ${flightId}`);
    return flight;
  }

  #requireBookable(flight) {
    const status = this.getFlightStatus(flight);
    if (!status.bookable) {
      throw new StateError(`Flight ${flight.flightNumber} is closed for booking (${status.label}).`);
    }
  }

  /** A passenger may hold only one live booking (confirmed, checked in or waitlisted) per flight. */
  #requireNoActiveBooking(passenger, flight) {
    if (this.hasActiveBooking(passenger, flight)) {
      throw new StateError(`${passenger.fullName} already has a booking on flight ${flight.flightNumber}.`);
    }
  }

  #addBooking(booking) {
    this.#bookings.set(booking.bookingId, booking);
    this.#bookingIds.observe(booking.bookingId);
    if (booking.reference) this.#references.add(booking.reference);
  }

  /** A booking reference nobody else has. */
  #newReference() {
    for (;;) {
      const reference = generateReference(this.#random);
      if (!this.#references.has(reference)) return reference;
    }
  }

  // ── Persistence (localStorage) ────────────────────────────────────────────

  #snapshot() {
    return {
      version: SAVE_VERSION,
      flights: this.getAllFlights().map((f) => ({
        id: f.id, flightNumber: f.flightNumber, origin: f.origin, destination: f.destination,
        departureTime: f.departureTime.toISOString(), arrivalTime: f.arrivalTime.toISOString(),
        cancelled: f.isCancelled, externalSeats: f.externalSeats,
        // optional extras are only written when the flight has them
        ...(f.airline ? { airline: f.airline } : {}),
        ...(f.fares ? { fares: f.fares } : {}),
        ...(f.originTimeZone ? { originTimeZone: f.originTimeZone } : {}),
        ...(f.destinationTimeZone ? { destinationTimeZone: f.destinationTimeZone } : {}),
      })),
      passengers: this.getAllPassengers().map((p) => ({
        passengerId: p.passengerId, fullName: p.fullName, email: p.email,
        passport: p.passportNumber, phone: p.phone,
      })),
      bookings: this.getAllBookings().map((b) => ({
        bookingId: b.bookingId, passengerId: b.passenger.passengerId,
        flightId: b.flight.id, flightNumber: b.flight.flightNumber,
        seatNumber: b.seat ? b.seat.seatNumber : '', status: b.status,
        bookingTime: b.bookingTime.toISOString(), fare: b.calculateTotal(), privateSuite: b.hasPrivateSuite,
        reference: b.reference,
      })),
    };
  }

  #save() {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify(this.#snapshot()));
    } catch (e) {
      console.warn('Could not save data:', e);
    }
  }

  /** Reloads saved data. Returns true if there was a usable save. */
  #load() {
    let raw = null;
    try {
      raw = this.#storage ? this.#storage.getItem(this.#storageKey) : null;
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    try {
      this.#restore(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn('Saved data could not be read, starting fresh:', e);
      this.#clearAll();
      return false;
    }
  }

  #restore(data) {
    for (const f of data.flights ?? []) {
      // Saves from version 1 have no id (it was the flight number), airline, fares or time zones.
      const flight = new Flight(f.flightNumber, f.origin, f.destination, new Date(f.departureTime), new Date(f.arrivalTime), {
        id: f.id, airline: f.airline, fares: f.fares, originTimeZone: f.originTimeZone, destinationTimeZone: f.destinationTimeZone,
      });
      (f.externalSeats ?? []).forEach((seatNumber) => flight.blockSeat(seatNumber));
      if (f.cancelled) flight.cancel();
      this.#flights.set(flight.id, flight);
    }
    for (const p of data.passengers ?? []) {
      const passenger = new Passenger(p.passengerId, p.fullName, p.email, p.passport, p.phone ?? '');
      this.#passengers.set(passenger.passengerId, passenger);
      this.#passengerIds.observe(passenger.passengerId);
    }
    for (const record of data.bookings ?? []) {
      try {
        this.#restoreBooking(record);
      } catch (e) {
        console.warn(`Skipping booking ${record.bookingId}: ${e.message}`);   // one bad row must not lose the rest
      }
    }
  }

  /** Turns one saved booking back into a Booking, including the seat / waitlist state that goes with it. */
  #restoreBooking(r) {
    const passenger = this.#passengers.get(r.passengerId);
    const flight = this.#flights.get(r.flightId ?? r.flightNumber);
    if (!passenger || !flight) throw new Error('unknown passenger or flight');
    const seat = r.seatNumber ? flight.getSeat(r.seatNumber) : null;
    const when = new Date(r.bookingTime);

    let booking;
    switch (r.status) {
      case BookingStatus.WAITLISTED:
        booking = Booking.waitlisted(r.bookingId, passenger, flight, when, r.reference);
        this.#waitlist.add(booking);
        break;
      case BookingStatus.CANCELLED:
        booking = new Booking(r.bookingId, passenger, flight, seat, when, r.status, r.fare, r.privateSuite, r.reference);
        break;
      case BookingStatus.CONFIRMED:
      case BookingStatus.CHECKED_IN:
        if (!seat || seat.isOccupied) throw new Error(`seat ${r.seatNumber} is unavailable`);
        if (r.privateSuite && seat instanceof FirstClassSeat) seat.setPrivateSuite(true);
        seat.occupy(passenger.fullName);
        booking = new Booking(r.bookingId, passenger, flight, seat, when, r.status, r.fare, r.privateSuite, r.reference);
        break;
      default:
        throw new Error(`unknown status ${r.status}`);
    }
    this.#addBooking(booking);
    if (booking.isActive) passenger.addBooking(booking);
  }
}
