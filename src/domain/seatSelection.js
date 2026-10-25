/**
 * Picks `count` free seats in one cabin for a group, keeping them together where possible.
 * First choice: a run of neighbouring seats in the same row (frontmost row first). Otherwise the first free seats
 * of the cabin in seat-map order, which also keeps the group in as few rows as possible.
 *
 * @returns seat numbers (["12A", "12B"]), or null if the cabin does not have `count` free seats
 */
export function findSeatsTogether(flight, seatClass, count, exclude = []) {
  const skip = new Set(exclude);
  const free = flight.getAvailableSeatsByClass(seatClass).filter((s) => !skip.has(s.seatNumber));
  if (count < 1 || free.length < count) return null;

  const rows = new Map();                                   // row number -> free seats in that row, left to right
  for (const seat of free) {
    const row = parseInt(seat.seatNumber, 10);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(seat);
  }
  const letter = (seat) => seat.seatNumber.replace(/\d+/g, '').charCodeAt(0);
  for (const seats of rows.values()) {
    for (let start = 0; start + count <= seats.length; start++) {
      const run = seats.slice(start, start + count);
      if (run.every((seat, i) => i === 0 || letter(seat) === letter(run[i - 1]) + 1)) {
        return run.map((seat) => seat.seatNumber);
      }
    }
  }
  return free.slice(0, count).map((seat) => seat.seatNumber);
}
