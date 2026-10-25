/**
 * Hands out ids like "PAX-004" or "BK012".
 * Uses a counter rather than "size + 1", so ids are never reused. When saved data is reloaded,
 * observe() moves the counter past the highest id already in use.
 */
export class IdGenerator {
  #prefix; #digits; #next = 1;

  constructor(prefix, digits) {
    this.#prefix = prefix;
    this.#digits = digits;
  }

  /** The id the next new item will get. Calling this does not use it up. */
  peek() {
    return this.#prefix + String(this.#next).padStart(this.#digits, '0');
  }

  /** Records that an id is in use, so future ids are always higher. Ignores ids in other formats. */
  observe(id) {
    if (typeof id !== 'string' || !id.startsWith(this.#prefix)) return;
    const number = Number(id.slice(this.#prefix.length));
    if (Number.isInteger(number)) this.#next = Math.max(this.#next, number + 1);
  }
}
