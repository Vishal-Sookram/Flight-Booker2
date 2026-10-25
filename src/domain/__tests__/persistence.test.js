import { escapeField, parseLine, toRow } from '../csv.js';
import { BookingStatus } from '../booking.js';
import { BookingService, STORAGE_KEY } from '../bookingService.js';
import { MemoryStorage, MutableClock, START, DAY, addFlight, addPassengers, fill, makeService } from '../testing.js';

describe('csv', () => {
  test('plain fields are not quoted; commas and quotes survive a round trip', () => {
    expect(escapeField('Alice')).toBe('Alice');
    const fields = ['PAX-006', 'Smith, Bob "Bobby"', '', 'x@y.com'];
    expect(parseLine(toRow(fields))).toEqual(fields);
    expect(escapeField(null)).toBe('');
    expect(parseLine('')).toEqual(['']);
  });
});

describe('saving and reloading', () => {
  const reload = (storage, clock) => new BookingService({ now: clock.now, storage, seedDemo: false });

  test('everything survives a save and reload', () => {
    const storage = new MemoryStorage();
    const { service, clock } = makeService({ storage });
    const flight = addFlight(service, clock, { daysAhead: 90 });
    const [alice, bob, carol] = addPassengers(service, 3);
    flight.blockSeat('10C');
    const suite = service.createBooking(alice.passengerId, 'BA0117', '1A', true);
    const checked = service.createBooking(bob.passengerId, 'BA0117', '12A');
    service.checkIn(checked.bookingId);
    const gone = service.cancelBooking(service.createBooking(carol.passengerId, 'BA0117', '12B').bookingId);
    expect(gone.booking.status).toBe(BookingStatus.CANCELLED);

    const copy = reload(storage, clock);
    expect(copy.getAllFlights()).toHaveLength(1);
    expect(copy.getAllPassengers().map((p) => p.passengerId)).toEqual(['PAX-001', 'PAX-002', 'PAX-003']);
    const f = copy.getFlight('BA0117');
    expect(f.externalSeats).toEqual(['10C']);
    expect(f.getSeat('1A').hasPrivateSuite).toBe(true);
    expect(f.getSeat('12B').isOccupied).toBe(false);
    const bookings = copy.getAllBookings();
    expect(bookings.map((b) => b.status)).toEqual([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CANCELLED]);
    expect(bookings[0].calculateTotal()).toBe(suite.calculateTotal());   // fare restored exactly (suite + early bird)
    expect(copy.getPassenger('PAX-002').bookings).toHaveLength(1);       // the cancelled one is not "active"
    // ids carry on after the highest saved one
    const dan = copy.registerPassenger({ fullName: 'Dan', email: 'd@x.com', passport: 'D1' });
    expect(dan.passengerId).toBe('PAX-004');
    expect(copy.createBooking('PAX-004', 'BA0117', '12C').bookingId).toBe('BK004');
  });

  test('a waitlisted passenger is still promoted after a reload', () => {
    const storage = new MemoryStorage();
    const { service, clock } = makeService({ storage });
    const flight = addFlight(service, clock);
    const [alice, bob] = addPassengers(service, 2);
    const held = service.createBooking(alice.passengerId, 'BA0117', '6A');
    fill(flight);
    service.joinWaitlist(bob.passengerId, 'BA0117');

    const copy = reload(storage, clock);
    expect(copy.getWaitlist('BA0117').map((p) => p.fullName)).toEqual(['Bob Smith']);
    const result = copy.cancelBooking(held.bookingId);
    expect(result.promoted.passenger.fullName).toBe('Bob Smith');
    expect(result.promoted.seat.seatNumber).toBe('6A');
  });

  test('a broken booking row is skipped without losing the rest; corrupt data starts fresh', () => {
    const storage = new MemoryStorage();
    const { service, clock } = makeService({ storage });
    addFlight(service, clock);
    const [alice, bob] = addPassengers(service, 2);
    service.createBooking(alice.passengerId, 'BA0117', '12A');
    service.createBooking(bob.passengerId, 'BA0117', '12B');

    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    saved.bookings[0].passengerId = 'PAX-999';                 // points at nobody
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const spy = console.warn;
    console.warn = () => {};
    try {
      expect(reload(storage, clock).getAllBookings().map((b) => b.bookingId)).toEqual(['BK002']);
      storage.setItem(STORAGE_KEY, '{ this is not json');
      expect(reload(storage, clock).getAllFlights()).toHaveLength(0);
    } finally {
      console.warn = spy;
    }
  });
});

describe('demo data', () => {
  test('is relative to today, saved on first run, and not re-created on the next visit', () => {
    const storage = new MemoryStorage();
    const clock = new MutableClock(START);
    const first = new BookingService({ now: clock.now, storage });
    const flights = first.getAllFlights();
    expect(flights.length).toBeGreaterThanOrEqual(7);
    expect(first.getAllPassengers()).toHaveLength(5);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();

    const upcoming = flights.filter((f) => first.isBookable(f));
    expect(upcoming.length).toBeGreaterThan(4);
    expect(flights.some((f) => first.getFlightStatus(f).label === 'Departed')).toBe(true);
    expect(upcoming.some((f) => f.departureTime - START > 60 * DAY)).toBe(true);   // far enough for early bird

    first.registerPassenger({ fullName: 'New Person', email: 'n@x.com', passport: 'N1' });
    const second = new BookingService({ now: clock.now, storage });
    expect(second.getAllPassengers()).toHaveLength(6);
  });

  test('the waitlist demo works out of the box', () => {
    const clock = new MutableClock(START);
    const service = new BookingService({ now: clock.now, storage: null });
    const full = service.getFlight('LH0400');
    expect(full.hasAvailability()).toBe(false);

    const waiting = service.joinWaitlist('PAX-001', 'LH0400');   // Alice
    expect(waiting.status).toBe(BookingStatus.WAITLISTED);
    const davids = service.getBookingsForPassenger('PAX-004').find((b) => b.flight === full);
    const result = service.cancelBooking(davids.bookingId);
    expect(result.promoted).toBe(waiting);
    expect(waiting.seat.seatNumber).toBe('6A');
  });

  test('exporting bookings gives a header and one row per booking', () => {
    const { service, clock } = makeService();
    addFlight(service, clock);
    const [alice] = addPassengers(service, 1);
    service.createBooking(alice.passengerId, 'BA0117', '12A');
    const lines = service.exportBookingsCsv().trim().split('\n');
    expect(lines[0]).toBe('bookingId,passengerId,passengerName,flightNumber,seatNumber,status,privateSuite,bookingTime,fare');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^BK001,PAX-001,Alice Johnson,BA0117,12A,CONFIRMED,false,.+,99.00$/);
  });
});
