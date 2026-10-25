export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from one date to another (time of day ignored), like Java's ChronoUnit.DAYS. */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** A new Date `days` days after `base`, at the given time of day. */
export function addDays(base, days, hours = 0, minutes = 0) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hours, minutes);
}

/** "2027-01-15" - the format <input type="date"> uses. */
export function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2027-01-15T08:05" - the format <input type="datetime-local"> uses. */
export function toDateTimeInputValue(date) {
  return `${toDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "15 Jan 2027 08:05" */
export function formatDateTime(date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "15 Jan 2027" */
export function formatDate(date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** 435 -> "7h 15m", 60 -> "1h", 45 -> "45m". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
