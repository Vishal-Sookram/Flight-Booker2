import {
  TIME_SLOTS, SORTS, slotOfHour, priceRange, airlinesIn, filterOptions, sortOptions, isValidReturn, MIN_TURNAROUND_MINUTES,
} from '../tripSearch.js';

const at = (h, m = 0, day = 4) => new Date(Date.UTC(2026, 10, day, h, m));
const option = (name, { airline = 'A', price = 100, depart = 9, arrive = 12, minutes = 180, eco = price } = {}) => ({
  name, airline,
  prices: { Economy: eco, Business: price * 3, 'First Class': null },
  departureHour: depart, arrivalHour: arrive, durationMinutes: minutes,
  departureTime: at(depart), arrivalTime: at(depart, minutes),
});

const options = [
  option('night-cheap', { airline: 'Zeta', price: 50, depart: 2, arrive: 5, minutes: 300 }),
  option('morning', { airline: 'Alpha', price: 120, depart: 8, arrive: 11, minutes: 200 }),
  option('noon', { airline: 'Alpha', price: 90, depart: 13, arrive: 16, minutes: 150 }),
  option('late', { airline: 'Zeta', price: 200, depart: 21, arrive: 23, minutes: 120 }),
];
const names = (list) => list.map((o) => o.name);

describe('time slots', () => {
  test('cover the day exactly once, using the Django project\'s boundaries', () => {
    for (let h = 0; h < 24; h++) expect(TIME_SLOTS.filter((s) => h >= s.from && h < s.to)).toHaveLength(1);
    expect([0, 5, 6, 11, 12, 17, 18, 23].map((h) => slotOfHour(h).id)).toEqual(['early', 'early', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });
});

describe('filtering', () => {
  const all = { cabin: 'Economy' };

  test('no filters keeps everything that sells the cabin', () => {
    expect(names(filterOptions(options, all))).toEqual(names(options));
    expect(filterOptions(options, { cabin: 'First Class' })).toEqual([]);             // nobody sells it
  });

  test('price, departure time, arrival time and airline combine (all must match)', () => {
    expect(names(filterOptions(options, { ...all, maxPrice: 100 }))).toEqual(['night-cheap', 'noon']);
    expect(names(filterOptions(options, { ...all, departSlots: ['morning', 'afternoon'] }))).toEqual(['morning', 'noon']);
    expect(names(filterOptions(options, { ...all, arriveSlots: ['evening'] }))).toEqual(['late']);
    expect(names(filterOptions(options, { ...all, airlines: ['Alpha'] }))).toEqual(['morning', 'noon']);
    expect(names(filterOptions(options, { ...all, airlines: ['Alpha'], maxPrice: 100, departSlots: ['afternoon'] }))).toEqual(['noon']);
  });

  test('the price limit includes the limit itself', () => {
    expect(names(filterOptions(options, { ...all, maxPrice: 90 }))).toEqual(['night-cheap', 'noon']);
  });

  test('range and airline helpers', () => {
    expect(priceRange(options, 'Economy')).toEqual({ min: 50, max: 200 });
    expect(priceRange(options, 'First Class')).toBeNull();
    expect(airlinesIn(options)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('sorting', () => {
  test('each sort order works, never changes the input, and breaks ties by departure', () => {
    const copy = [...options];
    expect(names(sortOptions(options, 'price', 'Economy'))).toEqual(['night-cheap', 'noon', 'morning', 'late']);
    expect(names(sortOptions(options, 'departure', 'Economy'))).toEqual(['night-cheap', 'morning', 'noon', 'late']);
    expect(names(sortOptions(options, 'duration', 'Economy'))).toEqual(['late', 'noon', 'morning', 'night-cheap']);
    expect(names(sortOptions(options, 'arrival', 'Economy'))).toEqual(['night-cheap', 'morning', 'noon', 'late']);
    expect(options).toEqual(copy);
    expect(names(sortOptions(options, 'nonsense', 'Economy'))).toEqual(names(sortOptions(options, 'price', 'Economy')));
    const tied = [option('b', { price: 10, depart: 15 }), option('a', { price: 10, depart: 7 })];
    expect(names(sortOptions(tied, 'price', 'Economy'))).toEqual(['a', 'b']);
    expect(SORTS.map((s) => s.id)).toEqual(['price', 'departure', 'duration', 'arrival']);
  });
});

describe('return trips', () => {
  test('the return flight must leave at least the minimum turnaround after the outbound lands', () => {
    const out = { arrivalTime: at(12) };
    expect(MIN_TURNAROUND_MINUTES).toBe(120);
    expect(isValidReturn(out, { departureTime: at(13) })).toBe(false);
    expect(isValidReturn(out, { departureTime: at(14) })).toBe(true);
    expect(isValidReturn(out, { departureTime: at(9, 0, 5) })).toBe(true);
    expect(isValidReturn(out, { departureTime: at(11) })).toBe(false);
  });
});
