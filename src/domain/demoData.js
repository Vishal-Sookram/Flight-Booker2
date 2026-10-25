import { addDays } from './dates.js';
import { fillToLoad } from './load.js';

/**
 * First-run data, measured from "now" so there are always upcoming flights (some far enough ahead
 * to show the early-bird discount), a few passengers, sample bookings, and "other customers" so each
 * flight has a realistic load. Uses only the service's public methods.
 */
export function seedDemoData({ service, now }) {
  //        number    from   to     days  hh  mm  minutes load
  const flights = [
    ['BA0117', 'LHR', 'JFK',   3, 10, 30, 495, 0.55],
    ['EK0003', 'LHR', 'DXB',   5, 21, 15, 400, 0.70],
    ['EK0004', 'DXB', 'LHR',  12,  8, 40, 445, 0.40],
    ['LH0400', 'FRA', 'JFK',  30, 11,  0, 500, 1.00],   // full: demonstrates the waitlist
    ['AF1081', 'LHR', 'CDG',  75,  8,  5,  80, 0.20],
    ['QR0007', 'LHR', 'DOH',  90, 14,  0, 345, 0.30],
    ['BA0178', 'JFK', 'LHR', 120, 19, 30, 425, 0.10],
    ['BA0115', 'JFK', 'LHR',  -1, 19, 30, 425, 0.80],   // already departed: demonstrates flight status
  ];
  const loads = new Map();
  for (const [flightNumber, origin, destination, days, hh, mm, minutes, load] of flights) {
    const departureTime = addDays(now, days, hh, mm);
    service.addFlight({
      flightNumber, origin, destination, departureTime,
      arrivalTime: new Date(departureTime.getTime() + minutes * 60000),
    });
    loads.set(flightNumber, load);
  }

  service.registerPassenger({ fullName: 'Alice Johnson',  email: 'alice@email.com', passport: 'GB123456', phone: '+44 7700 900123' });
  service.registerPassenger({ fullName: 'Bob Smith',      email: 'bob@email.com',   passport: 'GB654321', phone: '' });
  service.registerPassenger({ fullName: 'Carol Williams', email: 'carol@email.com', passport: 'GB246810', phone: '+44 7700 900456' });
  service.registerPassenger({ fullName: 'David Brown',    email: 'david@email.com', passport: 'US135792', phone: '' });
  service.registerPassenger({ fullName: 'Eva Martinez',   email: 'eva@email.com',   passport: 'ES112233', phone: '+34 600 123 456' });

  service.createBooking('PAX-001', 'BA0117', '12A');
  service.createBooking('PAX-002', 'EK0003', '3B');
  service.createBooking('PAX-003', 'AF1081', '1A');
  service.createBooking('PAX-001', 'QR0007', '8C');
  service.createBooking('PAX-004', 'LH0400', '6A');   // the one seat David can cancel to free up LH0400

  // Fill each flight up to its load factor with other customers (done last so the sample bookings
  // above keep the seats they chose).
  for (const flight of service.getAllFlights()) {
    fillToLoad(flight, loads.get(flight.flightNumber) ?? 0);
  }
}
