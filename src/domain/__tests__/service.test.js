import { ValidationError, StateError } from '../errors.js';
import { BookingStatus } from '../booking.js';
import { FirstClassSeat } from '../seat.js';
import { DAY, MINUTE, makeService, addFlight, addPassengers, fill } from '../testing.js';

let service, clock, flight, alice, bob, carol;

beforeEach(() => {
  ({ service, clock } = makeService());
  flight = addFlight(service, clock, { daysAhead: 10 });
  [alice, bob, carol] = addPassengers(service, 3);
});

describe('booking', () => {
  test('booking occupies the seat and charges the seat price', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
    expect(b.status).toBe(BookingStatus.CONFIRMED);
    expect(b.calculateTotal()).toBe(9900);
    expect(flight.getSeat('12A').isOccupied).toBe(true);
    expect(flight.getSeat('12A').passengerName).toBe('Alice Johnson');
    expect(alice.bookings).toHaveLength(1);
    expect(b.bookingId).toBe('BK001');
  });

  test('the early-bird discount is applied and the fare stays fixed afterwards', () => {
    const far = addFlight(service, clock, { number: 'QR0007', to: 'DOH', daysAhead: 90 });
    const b = service.createBooking(alice.passengerId, 'QR0007', '8C');
    expect(b.calculateTotal()).toBe(8910);
    clock.advance(40 * DAY);                       // now only 50 days away: new bookings would pay full price
    expect(service.quote(far, far.getSeat('8D'))).toBe(9900);
    expect(b.calculateTotal()).toBe(8910);
  });

  test('a quote matches what will be charged', () => {
    const seat = flight.getSeat('1A');
    const quoted = service.quote(flight, seat, true);
    expect(service.createBooking(alice.passengerId, 'BA0117', '1A', true).calculateTotal()).toBe(quoted);
  });

  test('a private suite marks the seat and costs more', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '1A', true);
    expect(b.calculateTotal()).toBe(99900);
    expect(b.hasPrivateSuite).toBe(true);
    expect(flight.getSeat('1A')).toBeInstanceOf(FirstClassSeat);
    expect(flight.getSeat('1A').hasPrivateSuite).toBe(true);
    expect(b.getReceipt()).toContain('First Class Suite [1A]');
  });

  test('a suite on a non-First-Class seat is rejected with no side effects', () => {
    expect(() => service.createBooking(alice.passengerId, 'BA0117', '12A', true)).toThrow(ValidationError);
    expect(flight.getSeat('12A').isOccupied).toBe(false);
    expect(alice.bookings).toHaveLength(0);
    expect(service.getAllBookings()).toHaveLength(0);
  });

  test('a seat can only be sold once', () => {
    service.createBooking(alice.passengerId, 'BA0117', '12A');
    expect(() => service.createBooking(bob.passengerId, 'BA0117', '12A')).toThrow(StateError);
  });

  test('unknown passengers, flights and seats are rejected', () => {
    expect(() => service.createBooking('PAX-999', 'BA0117', '12A')).toThrow(ValidationError);
    expect(() => service.createBooking(alice.passengerId, 'ZZ999', '12A')).toThrow(ValidationError);
    expect(() => service.createBooking(alice.passengerId, 'BA0117', '99Z')).toThrow(ValidationError);
  });

  test('one live booking per flight, but rebooking after cancelling is fine', () => {
    const first = service.createBooking(alice.passengerId, 'BA0117', '12A');
    expect(() => service.createBooking(alice.passengerId, 'BA0117', '12B')).toThrow(StateError);
    service.cancelBooking(first.bookingId);
    expect(service.createBooking(alice.passengerId, 'BA0117', '12B').status).toBe(BookingStatus.CONFIRMED);
  });

  test('departed flights cannot be booked, and booking closes once boarding starts', () => {
    const dep = flight.departureTime.getTime();
    clock.time = dep - 61 * MINUTE;
    expect(service.createBooking(alice.passengerId, 'BA0117', '12A').status).toBe(BookingStatus.CONFIRMED);
    clock.time = dep - 59 * MINUTE;                       // boarding
    expect(() => service.createBooking(bob.passengerId, 'BA0117', '12B')).toThrow(StateError);
    clock.time = dep + MINUTE;                            // departed
    expect(() => service.createBooking(bob.passengerId, 'BA0117', '12B')).toThrow(StateError);
  });
});

describe('cancelling', () => {
  test('cancelling frees the seat and the booking stays in the history', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
    const result = service.cancelBooking(b.bookingId);
    expect(result.booking).toBe(b);
    expect(result.promoted).toBeNull();
    expect(flight.getSeat('12A').isOccupied).toBe(false);
    expect(alice.bookings).toHaveLength(0);                       // no longer counts towards the total
    expect(service.getBookingsForPassenger(alice.passengerId)).toHaveLength(1);
    expect(b.status).toBe(BookingStatus.CANCELLED);
  });

  test('cancelling twice fails, and an unknown id returns null', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
    service.cancelBooking(b.bookingId);
    expect(() => service.cancelBooking(b.bookingId)).toThrow(StateError);
    expect(service.cancelBooking('BK999')).toBeNull();
  });

  test('a booking cannot be cancelled after departure, but can while boarding', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
    const c = service.createBooking(bob.passengerId, 'BA0117', '12B');
    clock.time = flight.departureTime.getTime() - 30 * MINUTE;    // boarding
    expect(service.cancelBooking(b.bookingId).booking.status).toBe(BookingStatus.CANCELLED);
    clock.time = flight.departureTime.getTime() + MINUTE;         // departed
    expect(() => service.cancelBooking(c.bookingId)).toThrow(StateError);
  });

  test('cancelling a flight cancels every booking, empties the waitlist and stops new bookings', () => {
    service.createBooking(alice.passengerId, 'BA0117', '12A');
    fill(flight);
    service.joinWaitlist(bob.passengerId, 'BA0117');
    expect(service.cancelFlight('BA0117')).toBe(2);
    expect(service.getWaitlist('BA0117')).toHaveLength(0);
    expect(alice.bookings).toHaveLength(0);
    expect(service.getFlightStatus(flight).label).toBe('Cancelled');
    expect(() => service.createBooking(carol.passengerId, 'BA0117', '6A')).toThrow(StateError);
    expect(() => service.cancelFlight('BA0117')).toThrow(StateError);
  });

  test('checking in works until departure, then closes', () => {
    const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
    expect(service.checkIn(b.bookingId).status).toBe(BookingStatus.CHECKED_IN);
    const c = service.createBooking(bob.passengerId, 'BA0117', '12B');
    clock.time = flight.departureTime.getTime() + MINUTE;
    expect(() => service.checkIn(c.bookingId)).toThrow(StateError);
    expect(() => service.checkIn('BK999')).toThrow(ValidationError);
  });
});

describe('waitlist', () => {
  test('a full flight waitlists instead of throwing', () => {
    fill(flight);
    const b = service.createBooking(alice.passengerId, 'BA0117', '1A');
    expect(b.status).toBe(BookingStatus.WAITLISTED);
    expect(b.seat).toBeNull();
    expect(b.calculateTotal()).toBe(0);
    expect(service.getWaitlistPosition('BA0117', alice)).toBe(1);
  });

  test('joining the waitlist of a flight with seats is rejected', () => {
    expect(() => service.joinWaitlist(alice.passengerId, 'BA0117')).toThrow(StateError);
  });

  test('cancelling a confirmed booking promotes the first person waiting', () => {
    const david = service.registerPassenger({ fullName: 'David Brown', email: 'd@x.com', passport: 'D1' });
    const held = service.createBooking(david.passengerId, 'BA0117', '6A');
    fill(flight);
    const wa = service.joinWaitlist(alice.passengerId, 'BA0117');
    service.joinWaitlist(bob.passengerId, 'BA0117');
    expect(service.getWaitlist('BA0117').map((p) => p.fullName)).toEqual(['Alice Johnson', 'Bob Smith']);

    const result = service.cancelBooking(held.bookingId);
    expect(result.promoted).toBe(wa);
    expect(wa.status).toBe(BookingStatus.CONFIRMED);
    expect(wa.seat.seatNumber).toBe('6A');
    expect(wa.calculateTotal()).toBe(9900);
    expect(service.getWaitlist('BA0117').map((p) => p.fullName)).toEqual(['Bob Smith']);
    expect(flight.hasAvailability()).toBe(false);
  });

  test('leaving the waitlist frees no seat and promotes nobody', () => {
    fill(flight);
    const w = service.joinWaitlist(alice.passengerId, 'BA0117');
    const result = service.cancelBooking(w.bookingId);
    expect(result.promoted).toBeNull();
    expect(service.getWaitlist('BA0117')).toHaveLength(0);
    expect(alice.bookings).toHaveLength(0);
  });

  test('a passenger cannot join the same waitlist twice', () => {
    fill(flight);
    service.joinWaitlist(alice.passengerId, 'BA0117');
    expect(() => service.joinWaitlist(alice.passengerId, 'BA0117')).toThrow(StateError);
  });

  test('promotion is priced at the time of promotion', () => {
    const far = addFlight(service, clock, { number: 'QR0007', to: 'DOH', daysAhead: 61 });
    const held = service.createBooking(bob.passengerId, 'QR0007', '8C');     // booked 61 days out: discounted
    fill(far);
    const waiting = service.joinWaitlist(alice.passengerId, 'QR0007');
    clock.advance(5 * DAY);                                                  // now 56 days out
    service.cancelBooking(held.bookingId);
    expect(waiting.calculateTotal()).toBe(9900);                             // no early bird any more
  });
});

describe('passengers', () => {
  test('ids are sequential and never reused; a failed registration does not use one up', () => {
    expect(alice.passengerId).toBe('PAX-001');
    expect(carol.passengerId).toBe('PAX-003');
    expect(() => service.registerPassenger({ fullName: 'X', email: 'bad', passport: 'P9' })).toThrow(ValidationError);
    expect(service.registerPassenger({ fullName: 'Dan', email: 'dan@x.com', passport: 'P9' }).passengerId).toBe('PAX-004');
  });

  test('duplicate passports are rejected ignoring case', () => {
    expect(() => service.registerPassenger({ fullName: 'Imposter', email: 'i@x.com', passport: 'gb123456' })).toThrow(ValidationError);
  });

  test('blank fields are rejected', () => {
    expect(() => service.registerPassenger({ fullName: '', email: 'a@b.com', passport: 'P1' })).toThrow(ValidationError);
    expect(() => service.registerPassenger({ fullName: 'A', email: '', passport: 'P1' })).toThrow(ValidationError);
    expect(() => service.registerPassenger({ fullName: 'A', email: 'a@b.com', passport: '  ' })).toThrow(ValidationError);
  });
});

describe('flights and search', () => {
  test('duplicate flight numbers are rejected', () => {
    expect(() => addFlight(service, clock, { number: 'BA0117' })).toThrow(ValidationError);
  });

  test('search is case-insensitive, treats blanks as "any", and can filter by date', () => {
    addFlight(service, clock, { number: 'EK0003', to: 'DXB', daysAhead: 5 });
    addFlight(service, clock, { number: 'AF1081', to: 'CDG', daysAhead: 75 });
    expect(service.searchFlights({ origin: 'lhr', destination: 'jfk' }).map((f) => f.flightNumber)).toEqual(['BA0117']);
    expect(service.searchFlights({ origin: 'LHR' })).toHaveLength(3);
    expect(service.searchFlights({ origin: 'XXX' })).toHaveLength(0);
    const day = flight.departureTime;
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    expect(service.searchFlights({ origin: 'LHR', date: ymd }).map((f) => f.flightNumber)).toEqual(['BA0117']);
    expect(service.searchFlights({ origin: 'LHR', date: '2020-01-01' })).toHaveLength(0);
  });

  test('flights are listed earliest first', () => {
    addFlight(service, clock, { number: 'EK0003', to: 'DXB', daysAhead: 5 });
    addFlight(service, clock, { number: 'AF1081', to: 'CDG', daysAhead: 75 });
    expect(service.getAllFlights().map((f) => f.flightNumber)).toEqual(['EK0003', 'BA0117', 'AF1081']);
  });
});

describe('change notifications', () => {
  test('listeners hear about every change and the version goes up', () => {
    let calls = 0;
    const unsubscribe = service.subscribe(() => calls++);
    const before = service.getVersion();
    service.createBooking(alice.passengerId, 'BA0117', '12A');
    expect(calls).toBe(1);
    expect(service.getVersion()).toBe(before + 1);
    unsubscribe();
    service.createBooking(bob.passengerId, 'BA0117', '12B');
    expect(calls).toBe(1);
  });

  test('a failed operation does not notify, and a broken listener does not break bookings', () => {
    let calls = 0;
    service.subscribe(() => calls++);
    expect(() => service.createBooking('PAX-999', 'BA0117', '12A')).toThrow(ValidationError);
    expect(calls).toBe(0);

    const spy = console.error;
    console.error = () => {};
    try {
      service.subscribe(() => { throw new Error('broken screen'); });
      const b = service.createBooking(alice.passengerId, 'BA0117', '12A');
      expect(b.status).toBe(BookingStatus.CONFIRMED);
      expect(calls).toBe(1);
    } finally {
      console.error = spy;
    }
  });
});
