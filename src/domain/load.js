// Deterministic "other customers": makes every flight look realistically busy, the same way every time.

/** 32-bit FNV-1a hash of some text. */
export function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small seeded random generator: same seed, same sequence. */
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Blocks free seats (as "Other customer") until about `load` (0-1) of the sellable seats are taken. Seeded by flight id. */
export function fillToLoad(flight, load) {
  const sellable = flight.sellableSeats.length;
  const target = Math.round(sellable * load);
  const taken = sellable - flight.availableSeats.length;
  const free = flight.availableSeats.map((s) => s.seatNumber).sort();
  shuffle(free, mulberry32(hash(flight.id)));
  for (let i = 0; i < target - taken && i < free.length; i++) flight.blockSeat(free[i]);
}

/** How full a schedule flight is before anyone here books it: 15-85% full, and about 1 flight in 30 is sold out. */
export function loadFactorFor(flightId) {
  const u = mulberry32(hash(`${flightId}#load`))();
  return u < 0.033 ? 1 : 0.15 + 0.7 * u;
}

/** Applies the standard demand to a freshly created schedule flight. */
export function applyDemand(flight) {
  fillToLoad(flight, loadFactorFor(flight.id));
}
