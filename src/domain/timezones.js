import { MONTHS } from './dates.js';

/**
 * Time zone helpers (built on the browser's Intl database, so daylight-saving changes are handled for free).
 *
 * Airline schedules are written in LOCAL time: "departs Delhi 08:00, arrives Mumbai 10:15". To turn that into a
 * real moment (a Date) we need the airport's time zone, and to show it again we must format it in that zone.
 * Every function here accepts `timeZone = null`, meaning "the browser's own zone" - that is how flights added by
 * hand (which have no zone) have always behaved, so they are unchanged.
 *
 * A "date key" is a plain calendar date as text, "2027-01-15" (what <input type="date"> gives you).
 */

const pad = (n) => String(n).padStart(2, '0');

// Creating an Intl.DateTimeFormat is slow, so there is one per zone.
const formatters = new Map();
function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True if `timeZone` is a zone name the browser knows (e.g. "Europe/London"). */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch (e) {
    return false;
  }
}

/** The wall-clock reading in `timeZone` at the moment `date`: { year, month (1-12), day, hour, minute }. */
export function wallClock(date, timeZone = null) {
  if (!timeZone) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = Number(p.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** How far ahead of UTC the zone is at that moment, in milliseconds (London in summer: +3 600 000). */
function offsetMs(instantMs, timeZone) {
  const w = wallClock(new Date(instantMs), timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(instantMs / 60000) * 60000;
}

// ── Date keys ─────────────────────────────────────────────────────────────────────────────────────

/** Splits "2027-01-15" into numbers, or returns null if it is not a real calendar date (e.g. "2027-02-30"). */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof key === 'string' ? key : '');
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}

export const isValidDateKey = (key) => parseDateKey(key) !== null;

export function toDateKey({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

/** The calendar date it is in `timeZone` at the moment `date`. */
export function dateKeyOf(date, timeZone = null) {
  return toDateKey(wallClock(date, timeZone));
}

/** "2027-01-15" + 10 -> "2027-01-25". */
export function addDaysToDateKey(key, days) {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Not a date: ${key}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return toDateKey({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/** Whole days from one date key to another (negative if `to` is earlier). */
export function daysBetweenKeys(from, to) {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) throw new RangeError('Not a date');
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

/** Day of the week for a date key, numbered like the flight schedule: 0 = Monday ... 6 = Sunday. */
export function weekdayOfDateKey(key) {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Not a date: ${key}`);
  return (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
}

export const WEEKDAY_NAMES = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

// ── Local time <-> moments ────────────────────────────────────────────────────────────────────────

/**
 * The moment at which the wall clock in `timeZone` reads `minutesOfDay` on the date `key`.
 * (If that local time does not exist or happens twice because the clocks changed, the nearest sensible moment is used.)
 */
export function zonedTimeToDate(key, minutesOfDay, timeZone = null) {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Not a date: ${key}`);
  if (!timeZone) return new Date(p.year, p.month - 1, p.day, 0, minutesOfDay);
  const wall = Date.UTC(p.year, p.month - 1, p.day, 0, minutesOfDay);
  let guess = wall - offsetMs(wall, timeZone);
  guess = wall - offsetMs(guess, timeZone);          // second pass: the offset may differ at the corrected moment
  return new Date(guess);
}

// ── Formatting ────────────────────────────────────────────────────────────────────────────────────

/** "08:05" in the given zone. */
export function formatTimeIn(date, timeZone = null) {
  const w = wallClock(date, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** "15 Jan 2027" in the given zone. */
export function formatDateIn(date, timeZone = null) {
  const w = wallClock(date, timeZone);
  return `${pad(w.day)} ${MONTHS[w.month - 1]} ${w.year}`;
}

/** "15 Jan 2027 08:05" in the given zone - the same shape formatDateTime() has always produced. */
export function formatDateTimeIn(date, timeZone = null) {
  return `${formatDateIn(date, timeZone)} ${formatTimeIn(date, timeZone)}`;
}

/** "Fri 15 Jan" for a date key. */
export function formatDateKeyShort(key) {
  const p = parseDateKey(key);
  if (!p) return String(key);
  return `${WEEKDAY_NAMES[weekdayOfDateKey(key)]} ${pad(p.day)} ${MONTHS[p.month - 1]}`;
}

/** "Fri 15 Jan 2027" for a date key. */
export function formatDateKeyLong(key) {
  const p = parseDateKey(key);
  return p ? `${formatDateKeyShort(key)} ${p.year}` : String(key);
}
