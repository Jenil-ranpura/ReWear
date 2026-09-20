/**
 * P1-T4 — Global error handling producing the consistent API error shape:
 *   { "error": { "code": "<MACHINE_CODE>", "message": "<human-readable>" } }
 * (implementation.md §10, §16; no stack traces leak in production — §15.)
 *
 * Express 5 natively forwards rejected async route handlers here, so no
 * try/catch wrappers are needed in controllers.
 */

import env from '../config/env.js';
import logger from '../lib/logger.js';

/** Application error with a stable machine-readable code. */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function mapKnownErrors(err) {
  // Duplicate key (e.g. unique email index) → 409 EMAIL_TAKEN (§11).
  if (err.code === 11000) {
    return {
      status: 409,
      code: 'EMAIL_TAKEN',
      message: 'An account with this email already exists.',
    };
  }
  // Malformed ObjectId / cast failures → 400, not 500.
  if (err.name === 'CastError') {
    return { status: 400, code: 'VALIDATION', message: 'Invalid identifier format.' };
  }
  if (err.name === 'ValidationError') {
    return { status: 400, code: 'VALIDATION', message: 'The submitted data is invalid.' };
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return { status: 400, code: 'VALIDATION', message: 'Malformed request body.' };
  }
  return null;
}

export default function errorHandler(err, req, res, _next) {
  // _next: Express needs the 4-arg signature
  const mapped = mapKnownErrors(err);
  const status = mapped?.status ?? err.status ?? 500;
  const code = mapped?.code ?? err.code ?? 'INTERNAL';
  const message = mapped?.message ?? err.message ?? 'Something went wrong. Please try again.';

  // AppErrors (our own 4xx: INVALID_REFRESH, INVALID_CREDENTIALS, VALIDATION,
  // RATE_LIMITED, ACCOUNT_BANNED…) are expected flows, not failures — log them
  // as warnings without stacks. Only unexpected errors (500s / unknown shapes)
  // deserve the loud unhandled_error treatment. (User-facing papercut: the
  // silent session probe on page load was being logged as a scary stack trace.)
  const meta = {
    requestId: req.requestId,
    method: req.method,
    route: req.originalUrl,
    status,
    code,
  };
  if (err instanceof AppError && status < 500) {
    logger.warn('handled_client_error', { ...meta, message: err.message });
  } else {
    logger.error('unhandled_error', { ...meta, error: err });
  }

  res.status(status).json({
    error: {
      code,
      // §15: never leak internals in production responses.
      message: env.isProduction && status === 500 ? 'Internal server error.' : message,
    },
  });
}
