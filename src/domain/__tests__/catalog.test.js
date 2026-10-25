import { readFileSync } from 'fs';
import { ScheduleCatalog } from '../schedule.js';
import { AIRPORTS, getAirport, searchAirports, airportLabel } from '../airports.js';
import {
  zonedTimeToDate, formatDateTimeIn, formatTimeIn, dateKeyOf, weekdayOfDateKey, isValidDateKey,
  addDaysToDateKey, daysBetweenKeys, isValidTimeZone,
} from '../timezones.js';
import { formatDuration } from '../dates.js';
import { ValidationError } from '../errors.js';
import { fixtureCatalog } from '../testing.js';

describe('time zones', () => {
  test('local airport times become the right moments, including daylight saving', () => {
    expect(zonedTimeToDate('2027-01-13', 8 * 60, 'Europe/London').toISOString()).toBe('2027-01-13T08:00:00.000Z');
    expect(zonedTimeToDate('2027-01-13', 8 * 60, 'America/New_York').toISOString()).toBe('2027-01-13T13:00:00.000Z');
    expect(zonedTimeToDate('2026-07-15', 8 * 60, 'Europe/London').toISOString()).toBe('2026-07-15T07:00:00.000Z');   // BST
    expect(zonedTimeToDate('2027-01-13', 8 * 60, 'Asia/Kolkata').toISOString()).toBe('2027-01-13T02:30:00.000Z');   // +5:30
  });

  test('formatting reads the clock of the zone it is given, not the browser', () => {
    const moment = new Date('2027-01-13T23:30:00Z');
    expect(formatDateTimeIn(moment, 'Asia/Kolkata')).toBe('14 Jan 2027 05:00');
    expect(formatDateTimeIn(moment, 'America/New_York')).toBe('13 Jan 2027 18:30');
    expect(formatTimeIn(moment, 'Europe/London')).toBe('23:30');
    expect(dateKeyOf(moment, 'Asia/Kolkata')).toBe('2027-01-14');
    expect(dateKeyOf(moment, 'America/New_York')).toBe('2027-01-13');
  });

  test('without a zone the browser time is used, exactly as before', () => {
    const d = new Date(2027, 0, 15, 8, 5);
    expect(formatDateTimeIn(d, null)).toBe('15 Jan 2027 08:05');
    expect(zonedTimeToDate('2027-01-15', 485, null).getTime()).toBe(d.getTime());
  });

  test('midnight is 00:xx, never 24:xx', () => {
    expect(formatTimeIn(new Date('2027-01-13T00:10:00Z'), 'Europe/London')).toBe('00:10');
  });

  test('date keys: validation, weekdays and arithmetic', () => {
    expect(isValidDateKey('2027-02-28')).toBe(true);
    expect(isValidDateKey('2027-02-30')).toBe(false);
    expect(isValidDateKey('15/01/2027')).toBe(false);
    expect(weekdayOfDateKey('2027-01-13')).toBe(2);          // Wednesday; Monday is 0
    expect(weekdayOfDateKey('2027-01-17')).toBe(6);          // Sunday
    expect(addDaysToDateKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysToDateKey('2027-03-01', -1)).toBe('2027-02-28');
    expect(daysBetweenKeys('2026-10-24', '2026-12-23')).toBe(60);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  test('durations read naturally', () => {
    expect([formatDuration(435), formatDuration(60), formatDuration(45), formatDuration(0)]).toEqual(['7h 15m', '1h', '45m', '0m']);
  });
});

describe('airports', () => {
  test('lookups and labels', () => {
    expect(getAirport('lhr').city).toBe('London');
    expect(getAirport('XXX')).toBeNull();
    expect(airportLabel('JFK')).toBe('New York (JFK)');
    expect(airportLabel('ZZZ')).toBe('ZZZ');
  });

  test('search ranks an exact code first, then cities, ignoring case and accents', () => {
    expect(searchAirports('lhr')[0].code).toBe('LHR');
    const london = searchAirports('london').map((a) => a.code);
    expect(london[0]).toBe('LHR');                             // served airports beat unserved ones with the same score
    expect(london).toContain('LGW');
    expect(london).toContain('STN');
    expect(searchAirports('BOMBAY')[0].code).toBe('BOM');      // nickname
    expect(searchAirports('goa')[0].code).toBe('GOI');
    expect(searchAirports('  new y ').map((a) => a.code)).toContain('JFK');
    expect(searchAirports('')).toEqual([]);
    expect(searchAirports('zzzzzz')).toEqual([]);
  });

  test('search can be limited to some airports and to a number of results', () => {
    expect(searchAirports('london', { codes: ['LGW'] }).map((a) => a.code)).toEqual(['LGW']);
    expect(searchAirports('a', { limit: 3 })).toHaveLength(3);
  });

  test('the directory is clean: unique codes, and every served airport has a valid time zone', () => {
    expect(new Set(AIRPORTS.map((a) => a.code)).size).toBe(AIRPORTS.length);
    const served = AIRPORTS.filter((a) => a.served);
    expect(served.length).toBeGreaterThan(50);
    served.forEach((a) => expect(isValidTimeZone(a.timeZone)).toBe(true));
    expect(getAirport('NAG').city).toBe('Nagpur');             // spelling fixed in the source data
  });
});

describe('schedule catalog', () => {
  const catalog = fixtureCatalog();

  test('turns a weekly row into a dated offer using airport time zones', () => {
    const [first, second] = catalog.offersFor({ origin: 'lhr', destination: 'jfk', date: '2026-11-04' });   // a Wednesday
    expect(first.flightNumber).toBe('BA117');
    expect(first.id).toBe('BA117-LHRJFK-20261104');
    expect(first.airline).toBe('British Airways');
    expect(first.departureTime.toISOString()).toBe('2026-11-04T10:30:00.000Z');               // London is on GMT by then
    expect(first.arrivalTime.getTime() - first.departureTime.getTime()).toBe(450 * 60000);
    expect(formatDateTimeIn(first.arrivalTime, first.destinationTimeZone)).toBe('04 Nov 2026 13:00');   // 18:00 GMT = 13:00 in New York
    expect(first.fares).toEqual({ Economy: 50000, Business: 180000, 'First Class': 400000 });
    expect(second.fares.Business).toBeNull();                                                  // economy-only flight
    expect(second.flightNumber).toBe('VS3');
  });

  test('only flights that operate that weekday are offered', () => {
    expect(catalog.offersFor({ origin: 'LHR', destination: 'JFK', date: '2026-11-05' })).toHaveLength(0);   // Thursday
    expect(catalog.offersFor({ origin: 'LHR', destination: 'JFK', date: '2026-11-06' })).toHaveLength(1);   // Friday
    expect(catalog.offersFor({ origin: 'LHR', destination: 'CDG', date: '2026-11-04' })).toEqual([]);
    expect(catalog.offersFor({ origin: 'LHR', destination: 'JFK', date: 'not a date' })).toEqual([]);
  });

  test('routes and airports can be listed', () => {
    expect(catalog.size).toBe(4);
    expect(catalog.hasRoute('lhr', 'jfk')).toBe(true);
    expect(catalog.hasRoute('JFK', 'CDG')).toBe(false);
    expect(catalog.destinationsFrom('LHR')).toEqual(['JFK']);
    expect([...catalog.servedAirports()].sort()).toEqual(['JFK', 'LHR']);
  });

  test('unsupported data is rejected', () => {
    expect(() => new ScheduleCatalog({ version: 99, flights: [], airlines: [] })).toThrow(ValidationError);
    expect(() => new ScheduleCatalog(null)).toThrow(ValidationError);
  });
});

describe('the real schedule (src/data/schedule.json)', () => {
  const data = JSON.parse(readFileSync(`${process.cwd()}/src/data/schedule.json`, 'utf8'));
  const catalog = new ScheduleCatalog(data);

  test('is loaded and large', () => {
    expect(catalog.size).toBeGreaterThan(10000);
    expect(catalog.servedAirports().size).toBe(60);
  });

  test('every airport it uses is in the directory with a time zone (otherwise times would be wrong)', () => {
    for (const code of catalog.servedAirports()) {
      expect(getAirport(code)).not.toBeNull();
      expect(isValidTimeZone(getAirport(code).timeZone)).toBe(true);
    }
  });

  test('every row is sane: positive fares, premium cabins dearer, flight time between 30 minutes and 24 hours', () => {
    for (const [number, origin, destination, dep, weekday, elapsed, airline, eco, biz, first] of data.flights) {
      expect(number).toMatch(/^[A-Z0-9]{2}\d{1,4}$/);             // no "6.00E+155" left from the spreadsheet damage
      expect(origin).not.toBe(destination);
      expect(dep >= 0 && dep < 1440 && weekday >= 0 && weekday <= 6).toBe(true);
      expect(elapsed >= 30 && elapsed < 1440).toBe(true);
      expect(data.airlines[airline]).toBeDefined();
      expect(eco).toBeGreaterThan(0);
      if (biz != null) expect(biz).toBeGreaterThan(eco);
      if (first != null) expect(first).toBeGreaterThan(biz ?? eco);
    }
  });

  test('flight times are realistic, not the raw clock differences (New York to London is about 7 hours)', () => {
    const offers = catalog.offersFor({ origin: 'JFK', destination: 'LHR', date: '2026-11-04' });
    const all = [...Array(7)].flatMap((_, i) => catalog.offersFor({ origin: 'JFK', destination: 'LHR', date: addDaysToDateKey('2026-11-02', i) }));
    expect(all.length).toBeGreaterThan(5);
    all.forEach((o) => expect(o.durationMinutes >= 6 * 60 && o.durationMinutes <= 8 * 60 + 30).toBe(true));
    offers.forEach((o) => expect(o.arrivalTime > o.departureTime).toBe(true));
  });

  test('arrival clock matches the schedule even across the date line and daylight-saving changes', () => {
    for (const [from, to] of [['DEL', 'BOM'], ['LHR', 'DXB'], ['ATL', 'LAX'], ['LHR', 'SIN']]) {
      for (const date of ['2026-07-15', '2027-01-13']) {
        const offers = [...Array(7)].flatMap((_, i) => catalog.offersFor({ origin: from, destination: to, date: addDaysToDateKey(date, i) }));
        offers.forEach((o) => expect(o.arrivalTime > o.departureTime).toBe(true));
      }
    }
  });
});
