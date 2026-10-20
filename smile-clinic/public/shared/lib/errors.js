export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg || 'Bad request', details);
export const unauthorized = (msg) => new HttpError(401, msg || 'Authentication required');
export const forbidden = (msg) => new HttpError(403, msg || 'You do not have permission to do that');
export const notFound = (msg) => new HttpError(404, msg || 'Not found');
export const conflict = (msg, details) => new HttpError(409, msg || 'Conflict', details);
