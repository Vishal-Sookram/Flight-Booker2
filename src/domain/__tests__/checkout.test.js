import { ValidationError, StateError } from '../errors.js';
import { BookingStatus } from '../booking.js';
import { FlightStatus } from '../flight.js';
import { findSeatsTogether } from '../seatSelection.js';
import { generateReference, normaliseReference } from '../reference.js';
import { luhnValid, cardBrand, formatCardNumber, validateCard, MockPaymentGateway, PaymentError } from '../payment.js';
import { HOUR, MINUTE, DAY, makeService, addPassengers, fixtureCatalog, seededRandom } from '../testing.js';

const WED = '2026-11-04';        // 11 days after the test clock starts: no early bird
const FAR_WED = '2027-01-13';    // 81 days away: early bird
const NEW_PERSON = (n) => ({ details: { fullName: `New Person ${n}`, email: `n${n}@x.com`, passport: `NP${n}` } });

let service, clock, catalog;
beforeEach(() => {
  ({ service, clock } = makeService({ random: seededRandom(7) }));
  catalog = fixtureCatalog();
});

/** n free seats in a cabin, kept together (the flights are randomly part-full, so tests never assume a seat is free). */
const pick = (flight, n = 1, cabin = 'Economy') => findSeatsTogether(flight, cabin, n);

/** Moves the test clock to `minutes` before the flight leaves (the clock is in local time, flights are at fixed moments). */
const moveClockToBefore = (flight, minutes) => clock.advance(flight.departureTime.getTime() - clock.now().getTime() - minutes * MINUTE);

const optionFor = (flightNumber, date = WED, origin = 'LHR', destination = 'JFK') =>
  service.searchOptions(catalog, { origin, destination, date }).find((o) => o.flightNumber === flightNumber);

describe('flights from the schedule: fares and cabins', () => {
  test('a seat costs the flight\'s own fare for its cabin; early bird and suites work on top', () => {
    const flight = service.ensureFlight(optionFor('BA117', FAR_WED));
    const [eco] = pick(flight);
    expect(service.listPrice(flight, flight.getSeat(eco))).toBe(50000);
    expect(service.quote(flight, flight.getSeat(eco))).toBe(45000);                     // 10% off, 81 days out
    expect(service.listPrice(flight, flight.getSeat('3A'))).toBe(180000);
    expect(service.listPrice(flight, flight.getSeat('1A'), true)).toBe(420000);         // 4000 + 200 suite
    const near = service.ensureFlight(optionFor('BA117', WED));
    expect(service.quote(near, near.getSeat(eco))).toBe(50000);                         // no discount
  });

  test('a cabin the flight does not sell cannot be booked and does not count as free seats', () => {
    const flight = service.ensureFlight(optionFor('VS3'));
    expect(flight.offeredClasses).toEqual(['Economy']);
    expect(flight.sellableSeats).toHaveLength(60);
    expect(flight.getAvailabilityByClass().Business).toBeUndefined();
    const [alice] = addPassengers(service, 1);
    expect(() => service.createBooking(alice.passengerId, flight.id, '3A')).toThrow(ValidationError);
    expect(() => service.quote(flight, flight.getSeat('3A'))).toThrow(ValidationError);
    expect(service.getAllBookings()).toHaveLength(0);
  });

  test('when the sold cabins are full the flight is full, even though unsold seats exist', () => {
    const flight = service.ensureFlight(optionFor('VS3'));
    flight.availableSeats.forEach((s) => flight.blockSeat(s.seatNumber));
    expect(flight.hasAvailability()).toBe(false);
    const [alice] = addPassengers(service, 1);
    expect(service.createBooking(alice.passengerId, flight.id, '12A').status).toBe(BookingStatus.WAITLISTED);   // full: seat ignored
  });

  test('the same flight number on different dates is a different flight', () => {
    const a = service.ensureFlight(optionFor('BA117', WED));
    const b = service.ensureFlight(optionFor('BA117', '2026-11-11'));
    expect(a.flightNumber).toBe(b.flightNumber);
    expect(a.id).not.toBe(b.id);
    const [alice] = addPassengers(service, 1);
    service.createBooking(alice.passengerId, a.id, pick(a)[0]);
    expect(service.createBooking(alice.passengerId, b.id, pick(b)[0]).status).toBe(BookingStatus.CONFIRMED);   // not "already booked"
  });
});

describe('searching', () => {
  test('returns prices, times and seats left without creating anything', () => {
    const options = service.searchOptions(catalog, { origin: 'lhr', destination: 'jfk', date: WED });
    expect(options.map((o) => o.flightNumber)).toEqual(['BA117', 'VS3']);
    const [ba] = options;
    expect(ba.prices).toEqual({ Economy: 50000, Business: 180000, 'First Class': 400000 });
    expect(ba.departureHour).toBe(10);
    expect(ba.arrivalHour).toBe(13);                                  // New York clock
    expect(ba.status).toBe(FlightStatus.SCHEDULED);
    expect(ba.seatsLeft).toBeGreaterThan(0);
    expect(ba.materialized).toBe(false);
    expect(service.getAllFlights()).toHaveLength(0);                  // browsing changes nothing
    expect(service.getVersion()).toBe(0);
  });

  test('early-bird prices are shown in results', () => {
    expect(optionFor('BA117', FAR_WED).prices.Economy).toBe(45000);
    expect(optionFor('BA117', FAR_WED).listPrices.Economy).toBe(50000);
  });

  test('a cabin filter drops flights that do not sell it', () => {
    const business = service.searchOptions(catalog, { origin: 'LHR', destination: 'JFK', date: WED, cabin: 'Business' });
    expect(business.map((o) => o.flightNumber)).toEqual(['BA117']);
  });

  test('picking a result creates the flight once, and it keeps the seats it was shown with', () => {
    const shown = optionFor('BA117');
    const flight = service.ensureFlight(shown);
    expect(service.ensureFlight(optionFor('BA117'))).toBe(flight);
    expect(service.getAllFlights()).toHaveLength(1);
    expect(optionFor('BA117').materialized).toBe(true);
    expect(optionFor('BA117').seatsLeft).toBe(shown.seatsLeft);
    expect(flight.externalSeats.length).toBe(flight.sellableSeats.length - shown.seatsLeft);
  });

  test('the same flight always looks equally busy', () => {
    const other = makeService().service;
    expect(other.searchOptions(catalog, { origin: 'LHR', destination: 'JFK', date: WED })[0].seatsLeft).toBe(optionFor('BA117').seatsLeft);
  });

  test('flights added by hand show up too, and closed or cancelled flights do not', () => {
    const dep = new Date(2026, 10, 4, 12, 0);
    service.addFlight({ flightNumber: 'XX1', origin: 'LHR', destination: 'JFK', departureTime: dep, arrivalTime: new Date(dep.getTime() + 8 * HOUR) });
    const found = () => service.searchOptions(catalog, { origin: 'LHR', destination: 'JFK', date: WED }).map((o) => o.flightNumber).sort();
    expect(found()).toEqual(['BA117', 'VS3', 'XX1']);
    service.cancelFlight('XX1');
    expect(found()).toEqual(['BA117', 'VS3']);
    moveClockToBefore(optionFor('BA117').flight, 30);                 // BA117 is now boarding
    expect(optionFor('BA117')).toBeUndefined();
    expect(optionFor('VS3')).toBeDefined();
  });

  test('a cancelled schedule flight does not come back from the schedule', () => {
    const flight = service.ensureFlight(optionFor('VS3'));
    service.cancelFlight(flight.id);
    expect(optionFor('VS3')).toBeUndefined();
  });

  test('the cheapest fare per day is available for a flexible-dates strip', () => {
    const strip = service.cheapestByDate(catalog, { origin: 'LHR', destination: 'JFK', cabin: 'Economy', startDate: '2026-11-02', days: 5 });
    expect(strip.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(strip.map((d) => d.price)).toEqual([null, null, 45000, null, 50000]);          // Wed: VS3 at 450; Fri: BA119 at 500
  });
});

describe('group reservations', () => {
  const seatsOf = (flight) => pick(flight, 2).map((seatNumber) => ({ seatNumber }));
  const legsFor = (out, back) => [
    { flightId: out.id, seats: seatsOf(out) },
    ...(back ? [{ flightId: back.id, seats: seatsOf(back) }] : []),
  ];

  test('books a family on a return trip in one go, under one reference', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const back = service.ensureFlight(optionFor('BA118', '2026-11-11', 'JFK', 'LHR'));
    const [alice] = addPassengers(service, 1);
    const result = service.createReservation({ passengers: [{ passengerId: alice.passengerId }, NEW_PERSON(1)], legs: legsFor(out, back) });

    expect(result.bookings).toHaveLength(4);
    expect(new Set(result.bookings.map((b) => b.reference)).size).toBe(1);
    expect(result.reference).toMatch(/^[A-Z2-9]{6}$/);
    expect(result.total).toBe(50000 * 2 + 52000 * 2);
    expect(result.bookings.every((b) => b.seat.isOccupied)).toBe(true);
    expect(service.getPassenger('PAX-002').fullName).toBe('New Person 1');             // registered as part of the booking
    expect(service.getBookingsForPassenger('PAX-002')).toHaveLength(2);
  });

  test('it is all or nothing: one bad seat on the return leg changes nothing', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const back = service.ensureFlight(optionFor('BA118', '2026-11-11', 'JFK', 'LHR'));
    const legs = legsFor(out, back);
    back.blockSeat(legs[1].seats[1].seatNumber);                                       // someone else takes the 2nd return seat
    const [alice] = addPassengers(service, 1);
    const version = service.getVersion();
    expect(() => service.createReservation({ passengers: [{ passengerId: alice.passengerId }, NEW_PERSON(1)], legs })).toThrow(StateError);
    expect(out.getSeat(legs[0].seats[0].seatNumber).isOccupied).toBe(false);
    expect(service.getAllBookings()).toHaveLength(0);
    expect(service.getAllPassengers()).toHaveLength(1);                                // the new person was not registered
    expect(service.getVersion()).toBe(version);                                        // nobody was notified of a change
  });

  test('bad requests are rejected before anything happens', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const premium = service.ensureFlight(optionFor('VS3'));
    const [alice, bob] = addPassengers(service, 2);
    const ids = [{ passengerId: alice.passengerId }, { passengerId: bob.passengerId }];
    const [e1, e2] = seatsOf(out);
    const attempts = [
      [[], legsFor(out)],                                                                        // nobody
      [ids, []],                                                                                 // no flights
      [ids, [{ flightId: out.id, seats: [e1] }]],                                                // one seat for two people
      [ids, [{ flightId: out.id, seats: [e1, e1] }]],                                            // same seat twice
      [ids, [{ flightId: premium.id, seats: [{ seatNumber: '3A' }, { seatNumber: '12A' }] }]],   // cabin not sold
      [ids, [{ flightId: out.id, seats: [{ ...e1, privateSuite: true }, e2] }]],                 // suite in economy
      [[ids[0], ids[0]], legsFor(out)],                                                          // same person twice
      [[NEW_PERSON(1), NEW_PERSON(1)], legsFor(out)],                                            // same passport twice
      [[{ passengerId: 'PAX-404' }], legsFor(out)],
      [ids, [{ flightId: 'NOPE', seats: [{ seatNumber: '1A' }, { seatNumber: '1B' }] }]],
      [Array(10).fill(0).map((_, i) => NEW_PERSON(i)), legsFor(out)],                            // more than 9
    ];
    for (const [passengers, legs] of attempts) {
      expect(() => service.createReservation({ passengers, legs })).toThrow(Error);
    }
    expect(service.getAllBookings()).toHaveLength(0);
    expect(out.availableSeats).toHaveLength(out.sellableSeats.length - out.externalSeats.length);
    expect(service.getAllPassengers()).toHaveLength(2);
  });

  test('someone already on the flight cannot be booked on it again; closed flights are refused', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const [alice] = addPassengers(service, 1);
    const [a, b] = pick(out, 2);
    service.createBooking(alice.passengerId, out.id, a);
    expect(() => service.createReservation({ passengers: [{ passengerId: alice.passengerId }], legs: [{ flightId: out.id, seats: [{ seatNumber: b }] }] })).toThrow(StateError);
    moveClockToBefore(out, 30);                                                         // boarding: booking is closed
    expect(() => service.createReservation({ passengers: [NEW_PERSON(1)], legs: [{ flightId: out.id, seats: [{ seatNumber: b }] }] })).toThrow(StateError);
  });

  test('checkReservation says yes or no without changing anything', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const request = { passengers: [NEW_PERSON(1), NEW_PERSON(2)], legs: [{ flightId: out.id, seats: seatsOf(out) }] };
    const version = service.getVersion();
    expect(service.checkReservation(request)).toBe(true);
    expect(service.getVersion()).toBe(version);
    expect(service.getAllBookings()).toHaveLength(0);
    expect(service.getAllPassengers()).toHaveLength(0);
    out.blockSeat(request.legs[0].seats[0].seatNumber);                                // someone takes a seat meanwhile
    expect(() => service.checkReservation(request)).toThrow(StateError);
    expect(() => service.createReservation(request)).toThrow(StateError);
  });

  test('a private suite can be added per passenger', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const [first, second] = pick(out, 2, 'First Class');
    const result = service.createReservation({
      passengers: [NEW_PERSON(1), NEW_PERSON(2)],
      legs: [{ flightId: out.id, seats: [{ seatNumber: first, privateSuite: true }, { seatNumber: second }] }],
    });
    expect(result.bookings.map((b) => b.calculateTotal())).toEqual([420000, 400000]);
    expect(out.getSeat(first).hasPrivateSuite).toBe(true);
  });

  test('a reservation can be looked up by reference (any case) and cancelled as a whole', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const back = service.ensureFlight(optionFor('BA118', '2026-11-11', 'JFK', 'LHR'));
    const { reference } = service.createReservation({ passengers: [NEW_PERSON(1), NEW_PERSON(2)], legs: legsFor(out, back) });

    const found = service.getReservation(` ${reference.toLowerCase().slice(0, 3)}-${reference.toLowerCase().slice(3)} `);
    expect(found.bookings).toHaveLength(4);
    expect(found.flights.map((f) => f.flightNumber)).toEqual(['BA117', 'BA118']);          // in travel order
    expect(found.passengers).toHaveLength(2);
    expect(found.total).toBe(204000);
    expect(service.getReservation('ZZZZZZ')).toBeNull();

    const outcome = service.cancelReservation(reference);
    expect(outcome.cancelled).toHaveLength(4);
    expect(outcome.failed).toEqual([]);
    expect(out.availableSeats.length).toBe(out.sellableSeats.length - out.externalSeats.length);
    expect(service.getReservation(reference).isActive).toBe(false);
    expect(service.getReservation(reference).total).toBe(0);
  });

  test('cancelling a reservation reports the legs that can no longer be cancelled', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const back = service.ensureFlight(optionFor('BA118', '2026-11-11', 'JFK', 'LHR'));
    const { reference } = service.createReservation({ passengers: [NEW_PERSON(1), NEW_PERSON(2)], legs: legsFor(out, back) });
    clock.advance(12 * DAY);                                                          // the outbound flight has departed
    const outcome = service.cancelReservation(reference);
    expect(outcome.cancelled).toHaveLength(2);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0].reason).toMatch(/departed/);
  });

  test('a waitlist still works for a schedule flight', () => {
    const flight = service.ensureFlight(optionFor('VS3'));
    flight.availableSeats.forEach((s) => flight.blockSeat(s.seatNumber));
    const [alice] = addPassengers(service, 1);
    expect(service.joinWaitlist(alice.passengerId, flight.id).status).toBe(BookingStatus.WAITLISTED);
    expect(service.getWaitlistPosition(flight.id, alice)).toBe(1);
  });

  test('stats add up', () => {
    const out = service.ensureFlight(optionFor('BA117'));
    const { bookings } = service.createReservation({ passengers: [NEW_PERSON(1), NEW_PERSON(2)], legs: [{ flightId: out.id, seats: seatsOfPick(out) }] });
    service.cancelBooking(bookings[1].bookingId);
    service.checkIn(bookings[0].bookingId);
    const stats = service.getStats();
    expect(stats).toEqual({ flights: 1, upcomingFlights: 1, passengers: 2, bookings: 2, byStatus: { CHECKED_IN: 1, CANCELLED: 1 }, seatsSold: 1, revenue: 50000 });
  });
});

const seatsOfPick = (flight) => pick(flight, 2).map((seatNumber) => ({ seatNumber }));

describe('booking references', () => {
  test('look like "K7M2QX", avoid look-alike characters, and are never reused', () => {
    const random = seededRandom(3);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const ref = generateReference(random);
      expect(ref).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
      seen.add(ref);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(normaliseReference(' k7m-2qx ')).toBe('K7M2QX');

    const flight = service.ensureFlight(optionFor('BA117'));
    const people = addPassengers(service, 3);
    const seats = pick(flight, 3);
    const refs = people.map((p, i) => service.createBooking(p.passengerId, flight.id, seats[i]).reference);
    expect(new Set(refs).size).toBe(3);
  });

  test('a single booking can be given a reference, and a reservation reuses one reference for its bookings', () => {
    const flight = service.ensureFlight(optionFor('BA117'));
    const [alice, bob] = addPassengers(service, 2);
    const [a, b] = pick(flight, 2);
    expect(service.createBooking(alice.passengerId, flight.id, a, false, { reference: 'abc234' }).reference).toBe('ABC234');
    expect(service.createBooking(bob.passengerId, flight.id, b).reference).not.toBe('ABC234');
  });
});

describe('seating a group together', () => {
  const flight = () => service.ensureFlight(optionFor('BA117'));

  test('prefers neighbouring seats in one row', () => {
    const f = flight();
    f.availableSeats.forEach((s) => f.blockSeat(s.seatNumber));
    ['6A', '6B', '6C', '7C', '7D', '7E'].forEach((n) => { f.getSeat(n).vacate(); });
    expect(findSeatsTogether(f, 'Economy', 3)).toEqual(['6A', '6B', '6C']);
    expect(findSeatsTogether(f, 'Economy', 3, ['6B'])).toEqual(['7C', '7D', '7E']);        // 6B excluded breaks the first run
  });

  test('falls back to the first free seats when no row has room, and gives up when the cabin is too small', () => {
    const f = flight();
    f.availableSeats.forEach((s) => f.blockSeat(s.seatNumber));
    ['6A', '6C', '8E'].forEach((n) => f.getSeat(n).vacate());
    expect(findSeatsTogether(f, 'Economy', 3)).toEqual(['6A', '6C', '8E']);
    expect(findSeatsTogether(f, 'Economy', 4)).toBeNull();
    expect(findSeatsTogether(f, 'Business', 1)).toBeNull();
    expect(findSeatsTogether(f, 'Economy', 0)).toBeNull();
  });
});

describe('payment (demo)', () => {
  test('card numbers are checked with the Luhn rule and recognised by brand', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(luhnValid('1234')).toBe(false);
    expect(cardBrand('4242424242424242')).toBe('Visa');
    expect(cardBrand('5555555555554444')).toBe('Mastercard');
    expect(cardBrand('378282246310005')).toBe('American Express');
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
  });

  test('the card form reports each problem', () => {
    const now = new Date(2026, 9, 24);
    const good = { number: '4242 4242 4242 4242', holder: 'A Person', expiryMonth: 10, expiryYear: 2026, cvv: '123' };
    expect(validateCard(good, now)).toEqual({ valid: true, errors: {} });
    expect(validateCard({ ...good, expiryMonth: 9 }, now).errors.expiry).toMatch(/expired/);
    expect(validateCard({ ...good, expiryMonth: '', expiryYear: '' }, now).errors.expiry).toBeDefined();
    expect(validateCard({ ...good, number: '4242 4242 4242 4243' }, now).errors.number).toBeDefined();
    expect(validateCard({ ...good, holder: '  ' }, now).errors.holder).toBeDefined();
    expect(validateCard({ ...good, cvv: '12' }, now).errors.cvv).toBeDefined();
    expect(validateCard({ ...good, number: '378282246310005', cvv: '123' }, now).errors.cvv).toMatch(/4 digits/);
    expect(Object.keys(validateCard({}, now).errors).sort()).toEqual(['cvv', 'expiry', 'holder', 'number']);
  });

  test('the demo gateway approves normal cards and declines the test decline card', async () => {
    const gateway = new MockPaymentGateway({ delayMs: 0 });
    const paid = await gateway.charge({ amount: 12345, card: { number: '4242 4242 4242 4242' } });
    expect(paid.last4).toBe('4242');
    expect(paid.brand).toBe('Visa');
    expect(paid.transactionId).toMatch(/^TXN-/);
    expect(Object.keys(paid)).not.toContain('number');                                  // the card number is not kept
    await expect(gateway.charge({ amount: 12345, card: { number: '4000 0000 0000 0002' } })).rejects.toThrow(PaymentError);
    await expect(gateway.charge({ amount: 0, card: { number: '4242424242424242' } })).rejects.toThrow(PaymentError);
  });
});
