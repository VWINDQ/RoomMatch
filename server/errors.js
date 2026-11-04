export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function assert(condition, status, message) {
  if (!condition) {
    throw new HttpError(status, message);
  }
}
