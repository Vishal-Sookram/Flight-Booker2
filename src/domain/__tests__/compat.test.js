import { BookingService, STORAGE_KEY } from '../bookingService.js';
import { BookingStatus } from '../booking.js';
import { MemoryStorage, MutableClock, START, DAY, fixtureCatalog, addPassengers, seededRandom } from '../testing.js';

const clock = () => new MutableClock(START);
const load = (storage, c = clock()) => new BookingService({ now: c.now, storage, seedDemo: false, random: seededRandom(5) });

/** A save file exactly as the app wrote it BEFORE this upgrade (version 1: no ids, references, fares or zones). */
function version1Save() {
  const dep = new Date(2026, 10, 20, 10, 0);
  return {
    version: 1,
    flights: [
      { flightNumber: 'BA0117', origin: 'LHR', destination: 'JFK', departureTime: dep.toISOString(), arrivalTime: new Date(dep.getTime() + 8 * 3600000).toISOString(), cancelled: false, externalSeats: ['10C'] },
      { flightNumber: 'EK0003', origin: 'LHR', destination: 'DXB', departureTime: dep.toISOString(), arrivalTime: new Date(dep.getTime() + 7 * 3600000).toISOString(), cancelled: false, externalSeats: [] },
    ],
    passengers: [
      { passengerId: 'PAX-001', fullName: 'Alice Johnson', email: 'alice@email.com', passport: 'GB123456', phone: '' },
      { passengerId: 'PAX-002', fullName: 'Bob Smith', email: 'bob@email.com', passport: 'GB654321', phone: '' },
    ],
    bookings: [
      { bookingId: 'BK001', passengerId: 'PAX-001', flightNumber: 'BA0117', seatNumber: '12A', status: 'CONFIRMED', bookingTime: START.toISOString(), fare: 9900, privateSuite: false },
      { bookingId: 'BK002', passengerId: 'PAX-002', flightNumber: 'BA0117', seatNumber: '1A', status: 'CHECKED_IN', bookingTime: START.toISOString(), fare: 99900, privateSuite: true },
      { bookingId: 'BK003', passengerId: 'PAX-002', flightNumber: 'EK0003', seatNumber: '', status: 'WAITLISTED', bookingTime: START.toISOString(), fare: 0, privateSuite: false },
    ],
  };
}

describe('saved data from the previous version', () => {
  test('still loads: flights keep their number as id, seats and fares are intact', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(version1Save()));
    const service = load(storage);
    const flight = service.getFlight('BA0117');
    expect(flight.id).toBe('BA0117');
    expect(flight.externalSeats).toEqual(['10C']);
    expect(flight.airline).toBe('');
    expect(flight.fares).toBeNull();
    expect(flight.cabinFares).toEqual({ Economy: 9900, Business: 34900, 'First Class': 79900 });
    const bookings = service.getAllBookings();
    expect(bookings.map((b) => b.status)).toEqual([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.WAITLISTED]);
    expect(bookings[1].calculateTotal()).toBe(99900);
    expect(flight.getSeat('1A').hasPrivateSuite).toBe(true);
    expect(service.getWaitlist('EK0003').map((p) => p.fullName)).toEqual(['Bob Smith']);
  });

  test('old bookings are given references, and they are saved so they do not change', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(version1Save()));
    const first = load(storage);
    const refs = first.getAllBookings().map((b) => b.reference);
    expect(refs.every((r) => /^[A-Z2-9]{6}$/.test(r))).toBe(true);
    expect(new Set(refs).size).toBe(3);
    const second = load(storage);                                                       // a fresh visit: same references
    expect(second.getAllBookings().map((b) => b.reference)).toEqual(refs);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).version).toBe(2);
    expect(second.getReservation(refs[0].toLowerCase()).bookings).toHaveLength(1);
  });

  test('old data keeps working for new bookings, cancellations and the waitlist', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(version1Save()));
    const service = load(storage);
    expect(service.createBooking('PAX-001', 'EK0003', '5A').bookingId).toBe('BK004');
    const flight = service.getFlight('EK0003');
    expect(service.searchFlights({ origin: 'LHR', destination: 'DXB', date: flight.departureDateKey })).toHaveLength(1);
    expect(service.cancelBooking('BK001').booking.status).toBe(BookingStatus.CANCELLED);
  });
});

describe('saving schedule flights', () => {
  const WED = '2026-11-04';
  const searchBa = (service) => service.searchOptions(fixtureCatalog(), { origin: 'LHR', destination: 'JFK', date: WED }).find((o) => o.flightNumber === 'BA117');

  test('everything about a booked schedule flight survives a reload', () => {
    const storage = new MemoryStorage();
    const c = clock();
    const first = load(storage, c);
    const flight = first.ensureFlight(searchBa(first));
    const [alice, bob] = addPassengers(first, 2);
    const seats = flight.getAvailableSeatsByClass('Economy').slice(0, 2).map((s) => s.seatNumber);
    const { reference } = first.createReservation({
      passengers: [{ passengerId: alice.passengerId }, { passengerId: bob.passengerId }],
      legs: [{ flightId: flight.id, seats: seats.map((seatNumber) => ({ seatNumber })) }],
    });

    const copy = load(storage, c);
    const back = copy.getFlight('BA117-LHRJFK-20261104');
    expect(back.flightNumber).toBe('BA117');
    expect(back.airline).toBe('British Airways');
    expect(back.fares).toEqual({ Economy: 50000, Business: 180000, 'First Class': 400000 });
    expect(back.originTimeZone).toBe('Europe/London');
    expect(back.destinationTimeZone).toBe('America/New_York');
    expect(back.departureLabel).toBe('04 Nov 2026 10:30');
    expect(back.arrivalLabel).toBe('04 Nov 2026 13:00');
    expect(back.externalSeats).toEqual(flight.externalSeats);
    const reservation = copy.getReservation(reference);
    expect(reservation.bookings.map((b) => b.seat.seatNumber)).toEqual(seats);
    expect(reservation.total).toBe(100000);
    expect(searchBa(copy).materialized).toBe(true);
    expect(searchBa(copy).seatsLeft).toBe(searchBa(first).seatsLeft);
  });

  test('a waitlist on a schedule flight survives a reload', () => {
    const storage = new MemoryStorage();
    const c = clock();
    const first = load(storage, c);
    const flight = first.ensureFlight(searchBa(first));
    const [alice, bob] = addPassengers(first, 2);
    const held = flight.getAvailableSeatsByClass('Economy')[0].seatNumber;
    const booked = first.createBooking(alice.passengerId, flight.id, held);
    flight.availableSeats.forEach((s) => flight.blockSeat(s.seatNumber));
    first.joinWaitlist(bob.passengerId, flight.id);

    const copy = load(storage, c);
    expect(copy.getWaitlist(flight.id).map((p) => p.fullName)).toEqual(['Bob Smith']);
    expect(copy.cancelBooking(booked.bookingId).promoted.seat.seatNumber).toBe(held);
  });

  test('passengers and flights added by hand are saved exactly as before (no extra fields)', () => {
    const storage = new MemoryStorage();
    const c = clock();
    const service = load(storage, c);
    const dep = new Date(START.getTime() + 10 * DAY);
    service.addFlight({ flightNumber: 'XX1', origin: 'LHR', destination: 'JFK', departureTime: dep, arrivalTime: new Date(dep.getTime() + 3600000) });
    const saved = JSON.parse(storage.getItem(STORAGE_KEY)).flights[0];
    expect(Object.keys(saved).sort()).toEqual(['arrivalTime', 'cancelled', 'departureTime', 'destination', 'externalSeats', 'flightNumber', 'id', 'origin']);
  });
});
