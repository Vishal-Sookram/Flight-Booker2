/** Letters and digits with nothing easily confused when read aloud (no 0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A booking reference like "K7M2QX" (the Django project used 6 random hex characters; this avoids look-alikes). */
export function generateReference(random = Math.random, length = 6) {
  let ref = '';
  for (let i = 0; i < length; i++) ref += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return ref;
}

/** Tidies what a person typed: " k7m-2qx " -> "K7M2QX". */
export function normaliseReference(text) {
  return String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
}
