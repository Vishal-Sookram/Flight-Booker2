/**
 * Money is stored as a whole number of pence (e.g. £99.00 -> 9900), never as a decimal.
 * Floating point cannot represent most decimals exactly (99 * 0.9 = 89.10000000000001),
 * so all arithmetic is done on integers and only formatted for display. (Java lab: BigDecimal.)
 */
export const ZERO = 0;

/** pounds(99.5) -> 9950 */
export function pounds(amount) {
  return Math.round(Number(amount) * 100);
}

/** percentOf(79900, 90) -> 71910 : `percent` percent of an amount, rounded half-up. */
export function percentOf(pence, percent) {
  return Math.floor((pence * percent + 50) / 100);
}

/** "99.00" - for table cells and CSV. */
export function plain(pence) {
  return (pence / 100).toFixed(2);
}

/** "£99.00" - for receipts and labels. */
export function format(pence) {
  return '£' + plain(pence);
}
