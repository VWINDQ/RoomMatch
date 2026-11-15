export class HttpError extends Error {
  constructor(status, message, fieldErrors) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function assert(condition, status, message) {
  if (!condition) {
    throw new HttpError(status, message);
  }
}
