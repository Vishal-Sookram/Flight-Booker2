import { ValidationError, StateError } from '../errors.js';
import { Seat, EconomySeat, BusinessSeat, FirstClassSeat } from '../seat.js';
import { Flight, FlightStatus } from '../flight.js';
import { Passenger } from '../passenger.js';
import { Booking, BookingStatus } from '../booking.js';
import { PricingService } from '../pricing.js';
import { format, percentOf, pounds } from '../money.js';
import { daysBetween } from '../dates.js';

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const makeFlight = () => new Flight('BA0117', 'lhr', 'jfk', at(2027, 1, 15, 10, 30), at(2027, 1, 15, 17, 0));

describe('seats', () => {
  test('the seat map has the documented layout', () => {
    const f = makeFlight();
    expect(f.totalSeats).toBe(80);
    const count = (cls) => f.seats.filter((s) => s.seatClass === cls).length;
    expect(count('First Class')).toBe(8);
    expect(count('Business')).toBe(12);
    expect(count('Economy')).toBe(60);
    expect(f.getSeat('1A')).toBeInstanceOf(FirstClassSeat);
    expect(f.getSeat('5D')).toBeInstanceOf(BusinessSeat);
    expect(f.getSeat('15F')).toBeInstanceOf(EconomySeat);
    expect(f.getSeat('99Z')).toBeNull();
  });

  test('Seat itself is abstract, and prices are exact', () => {
    expect(() => new Seat('1A')).toThrow(TypeError);
    expect(new EconomySeat('6A').basePrice).toBe(9900);
    expect(new BusinessSeat('3A').basePrice).toBe(34900);
    expect(new FirstClassSeat('1A').basePrice).toBe(79900);
  });

  test('occupying twice fails; vacate frees the seat', () => {
    const seat = new EconomySeat('6A');
    seat.occupy('Alice');
    expect(seat.isOccupied).toBe(true);
    expect(() => seat.occupy('Bob')).toThrow(StateError);
    seat.vacate();
    expect(seat.isOccupied).toBe(false);
    expect(seat.passengerName).toBeNull();
  });

  test('a private suite adds the surcharge, is cleared when vacated, and locks once occupied', () => {
    const seat = new FirstClassSeat('1A');
    expect(seat.priceWith(true)).toBe(99900);
    expect(seat.basePrice).toBe(79900);           // priceWith does not change the seat
    seat.setPrivateSuite(true);
    expect(seat.basePrice).toBe(99900);
    seat.occupy('Alice');
    expect(() => seat.setPrivateSuite(false)).toThrow(StateError);
    seat.vacate();
    expect(seat.hasPrivateSuite).toBe(false);
    expect(seat.basePrice).toBe(79900);
  });
});

describe('flight', () => {
  test('availability drops as seats are taken, and a full class is missing from the map', () => {
    const f = makeFlight();
    expect(f.getAvailabilityByClass()).toEqual({ 'First Class': 8, Business: 12, Economy: 60 });
    f.getSeat('1A').occupy('x');
    expect(f.getAvailabilityByClass()['First Class']).toBe(7);
    f.seats.filter((s) => s.seatClass === 'Business').forEach((s) => s.occupy('x'));
    expect(f.getAvailabilityByClass().Business).toBeUndefined();
    expect(f.hasAvailability()).toBe(true);
    expect(f.getAvailableSeatsByClass('First Class')).toHaveLength(7);
  });

  test('blocked seats are remembered; unknown seats are rejected', () => {
    const f = makeFlight();
    f.blockSeat('10C'); f.blockSeat('11A');
    expect(f.externalSeats).toEqual(['10C', '11A']);
    expect(f.getSeat('10C').isOccupied).toBe(true);
    expect(() => f.blockSeat('10C')).toThrow(StateError);
    expect(() => f.blockSeat('99Z')).toThrow(ValidationError);
  });

  test('status follows the clock and booking closes an hour before departure', () => {
    const f = makeFlight();               // departs 15 Jan 2027 10:30
    expect(f.getStatus(at(2027, 1, 10))).toBe(FlightStatus.SCHEDULED);
    expect(f.getStatus(at(2027, 1, 15, 9, 29))).toBe(FlightStatus.SCHEDULED);
    expect(f.getStatus(at(2027, 1, 15, 9, 30))).toBe(FlightStatus.BOARDING);
    expect(f.getStatus(at(2027, 1, 15, 10, 30))).toBe(FlightStatus.DEPARTED);
    expect(FlightStatus.SCHEDULED.bookable).toBe(true);
    expect(FlightStatus.BOARDING.bookable).toBe(false);
    f.cancel();
    expect(f.getStatus(at(2027, 1, 10))).toBe(FlightStatus.CANCELLED);
  });

  test('invalid flights are rejected and codes are normalised', () => {
    expect(() => new Flight('', 'LHR', 'JFK', at(2027, 1, 1, 9), at(2027, 1, 1, 12))).toThrow(ValidationError);
    expect(() => new Flight('X1', 'LHR', 'LHR', at(2027, 1, 1, 9), at(2027, 1, 1, 12))).toThrow(ValidationError);
    expect(() => new Flight('X1', 'LHR', 'JFK', at(2027, 1, 1, 12), at(2027, 1, 1, 9))).toThrow(ValidationError);
    const f = makeFlight();
    expect(f.origin).toBe('LHR');
    expect(f.toString()).toBe('BA0117 | LHR → JFK | Dep: 15 Jan 2027 10:30');
  });
});

describe('money and dates', () => {
  test('formatting and exact percentages', () => {
    expect(format(9900)).toBe('£99.00');
    expect(format(pounds(89.1))).toBe('£89.10');
    expect(percentOf(79900, 90)).toBe(71910);
    expect(percentOf(9900, 90)).toBe(8910);      // not 8910.000000000001
  });

  test('daysBetween counts calendar days and ignores the time of day', () => {
    expect(daysBetween(at(2026, 10, 24, 23, 59), at(2026, 10, 25, 0, 1))).toBe(1);
    expect(daysBetween(at(2026, 10, 24, 9), at(2026, 12, 23, 9))).toBe(60);
  });
});

describe('booking and passenger', () => {
  const setup = () => {
    const flight = makeFlight();
    const passenger = new Passenger('PAX-001', 'Jane Doe', 'jane@x.com', 'gb123');
    const seat = flight.getSeat('12A');
    seat.occupy(passenger.fullName);
    const booking = Booking.confirmed('BK001', passenger, flight, seat, at(2026, 12, 1), 9900, false);
    passenger.addBooking(booking);
    return { flight, passenger, seat, booking };
  };

  test('the receipt has the documented format', () => {
    const { booking } = setup();
    expect(booking.getReceipt()).toBe('Booking #BK001 | LHR → JFK | Economy [12A] | £99.00 | CONFIRMED');
  });

  test('cancel frees the seat and cannot be repeated', () => {
    const { booking, seat } = setup();
    booking.cancel();
    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(seat.isOccupied).toBe(false);
    expect(() => booking.cancel()).toThrow(StateError);
  });

  test('check-in only works from CONFIRMED', () => {
    const { booking } = setup();
    booking.checkIn();
    expect(booking.status).toBe(BookingStatus.CHECKED_IN);
    expect(() => booking.checkIn()).toThrow(StateError);
  });

  test('a waitlisted booking costs nothing until it is confirmed', () => {
    const { flight, passenger } = setup();
    const waiting = Booking.waitlisted('BK002', passenger, flight, at(2026, 12, 2));
    expect(waiting.seat).toBeNull();
    expect(waiting.calculateTotal()).toBe(0);
    expect(waiting.getReceipt()).toContain('Waitlisted (no seat yet)');
    waiting.confirmFromWaitlist(flight.getSeat('12B'), 9900);
    expect(waiting.status).toBe(BookingStatus.CONFIRMED);
    expect(waiting.calculateTotal()).toBe(9900);
    expect(() => waiting.confirmFromWaitlist(flight.getSeat('12C'), 9900)).toThrow(StateError);
  });

  test('passenger totals are exact and the bookings list is read-only', () => {
    const { passenger, flight } = setup();
    const second = Booking.confirmed('BK002', passenger, flight, flight.getSeat('3A'), at(2026, 12, 1), 8910, false);
    passenger.addBooking(second);
    expect(passenger.calculateTotal()).toBe(18810);
    expect(() => passenger.bookings.push(second)).toThrow();
    expect(passenger.cancelBooking('BK002')).toBe(true);
    expect(passenger.cancelBooking('BK002')).toBe(false);
    expect(passenger.getReceipt()).toContain('Grand Total: £99.00');
  });

  test('passenger validation', () => {
    expect(() => new Passenger('P1', '', 'a@b.com', 'X1')).toThrow(ValidationError);
    expect(() => new Passenger('P1', 'Jane', 'not-an-email', 'X1')).toThrow(ValidationError);
    expect(() => new Passenger('P1', 'Jane', 'a@b.com', '')).toThrow(ValidationError);
    expect(() => new Passenger('P1', 'Jane', 'a@b.com', 'X1', 'abc')).toThrow(ValidationError);
    expect(new Passenger('P1', 'Jane', 'a@b.com', 'x1', '+44 7700 900123').phone).toBe('+44 7700 900123');
    expect(new Passenger('P1', 'Jane', 'a@b.com', 'x1').passportNumber).toBe('X1');
  });
});

describe('pricing', () => {
  const pricing = new PricingService();
  const flight = makeFlight();               // departs 15 Jan 2027
  const economy = flight.getSeat('6A');
  const first = flight.getSeat('1A');

  test('no discount close to departure', () => {
    expect(pricing.priceFor(flight, economy, false, at(2027, 1, 14))).toBe(9900);
  });

  test('early bird only applies when booked MORE than sixty days ahead', () => {
    expect(daysBetween(at(2026, 11, 16), flight.departureTime)).toBe(60);
    expect(pricing.priceFor(flight, economy, false, at(2026, 11, 16))).toBe(9900);   // exactly 60 days: no discount
    expect(daysBetween(at(2026, 11, 15), flight.departureTime)).toBe(61);
    expect(pricing.priceFor(flight, economy, false, at(2026, 11, 15))).toBe(8910);   // 61 days: 10% off
  });

  test('the early-bird price is exact, not a floating-point approximation', () => {
    expect(pricing.priceFor(flight, economy, false, at(2026, 10, 1)) / 100).toBe(89.1);
  });

  test('the suite surcharge only applies to First Class, and early bird applies to the suite too', () => {
    expect(pricing.priceFor(flight, first, true, at(2027, 1, 14))).toBe(99900);
    expect(pricing.priceFor(flight, economy, true, at(2027, 1, 14))).toBe(9900);
    expect(pricing.priceFor(flight, first, true, at(2026, 10, 1))).toBe(89910);
  });
});
