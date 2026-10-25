/**
 * Demo checkout. NO real payment is taken and NOTHING about the card is stored: the card form is checked here,
 * handed to a gateway, and forgotten. The gateway is a small interface - charge({ amount, card }) returning a
 * promise - so a real provider (Stripe, etc.) can replace MockPaymentGateway without touching the screens.
 */

export class PaymentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentError';
  }
}

const digitsOf = (text) => String(text ?? '').replace(/\D/g, '');

/** Luhn check: the checksum every real card number satisfies, which catches most typing mistakes. */
export function luhnValid(number) {
  const digits = digitsOf(number);
  if (digits.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(number) {
  const d = digitsOf(number);
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'American Express';
  return 'Card';
}

/** "4242424242424242" -> "4242 4242 4242 4242" (Amex: 4-6-5). */
export function formatCardNumber(text) {
  const d = digitsOf(text).slice(0, 19);
  if (/^3[47]/.test(d)) return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  return d.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Checks the card form. `expiryMonth` is 1-12, `expiryYear` a 4-digit year.
 * @returns { valid, errors } where errors has a message for each field that is wrong
 */
export function validateCard({ number, holder, expiryMonth, expiryYear, cvv }, now = new Date()) {
  const errors = {};
  const digits = digitsOf(number);
  if (digits.length === 0) errors.number = 'Enter the card number.';
  else if (!luhnValid(digits)) errors.number = 'That card number does not look right.';
  if (!String(holder ?? '').trim()) errors.holder = 'Enter the name on the card.';

  const month = Number(expiryMonth);
  const year = Number(expiryYear);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    errors.expiry = 'Choose the expiry month and year.';
  } else if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    errors.expiry = 'This card has expired.';
  }
  const cvvLength = cardBrand(digits) === 'American Express' ? 4 : 3;
  if (!new RegExp(`^\\d{${cvvLength}}$`).test(String(cvv ?? '').trim())) errors.cvv = `The security code is ${cvvLength} digits.`;
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Pretends to charge a card. Takes about a second; 4000 0000 0000 0002 is always declined (like Stripe's test cards). */
export class MockPaymentGateway {
  #delayMs; #sequence = 0;

  constructor({ delayMs = 1200 } = {}) { this.#delayMs = delayMs; }

  /** @returns Promise<{ transactionId, brand, last4, amount }> @throws PaymentError when declined */
  async charge({ amount, card }) {
    if (!Number.isInteger(amount) || amount <= 0) throw new PaymentError('Nothing to pay.');
    await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    const digits = digitsOf(card.number);
    if (digits === '4000000000000002') throw new PaymentError('Your card was declined. Try another card.');
    this.#sequence += 1;
    return { transactionId: `TXN-${Date.now().toString(36).toUpperCase()}${this.#sequence}`, brand: cardBrand(digits), last4: digits.slice(-4), amount };
  }
}
