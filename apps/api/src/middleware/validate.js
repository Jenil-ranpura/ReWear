/**
 * Request validation middleware (§15: "Yup schema validation on every request
 * body, server-side, regardless of frontend validation").
 * Validates req.body against a shared Yup schema and replaces it with the
 * cast/normalized result (e.g. lowercased email). Rejects unknown keys.
 * On failure: 400 VALIDATION with a field → message map (§10 error shape).
 */

import { AppError } from './errorHandler.js';

export default function validate(schema) {
  return async (req, _res, next) => {
    try {
      req.body = await schema.validate(req.body ?? {}, {
        abortEarly: false,
        stripUnknown: true,
        strict: false,
      });
      next();
    } catch (err) {
      next(new AppError(400, 'VALIDATION', err.errors?.join(', ') || 'Invalid request body.'));
    }
  };
}
