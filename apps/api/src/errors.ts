/** Throw from handlers/guards to produce `{ error: { code, message } }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
