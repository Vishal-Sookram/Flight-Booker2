import { plain } from './money.js';

/** Wraps a field in quotes if it contains a comma, quote or newline, so names like "Smith, Bob" survive. */
export function escapeField(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toRow(fields) {
  return fields.map(escapeField).join(',');
}

/** Splits one CSV line into fields, understanding quoted fields. */
export function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { current += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/** All bookings as CSV text (for the "Export CSV" button). */
export function bookingsToCsv(bookings) {
  const header = 'bookingId,passengerId,passengerName,flightNumber,seatNumber,status,privateSuite,bookingTime,fare';
  const rows = bookings.map((b) => toRow([
    b.bookingId,
    b.passenger.passengerId,
    b.passenger.fullName,
    b.flight.flightNumber,
    b.seat ? b.seat.seatNumber : '',
    b.status,
    b.hasPrivateSuite,
    b.bookingTime.toISOString(),
    plain(b.calculateTotal()),
  ]));
  return [header, ...rows].join('\n') + '\n';
}
