/**
 * Two kinds of failure, mirroring the Java lab's exceptions, so the UI can show a clear message.
 *   ValidationError - the input is wrong (unknown seat, bad email...)     (Java: IllegalArgumentException)
 *   StateError      - the input is fine but not allowed right now          (Java: IllegalStateException)
 */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateError';
  }
}
