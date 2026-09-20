/**
 * Query-string sibling of validate.js (§15: server-side validation on inputs,
 * not just bodies). Validates the query against a shared Yup schema and
 * exposes the normalized result as **req.validatedQuery** — NOT req.query,
 * which is a READ-ONLY getter in Express 5 (the same incompatibility that got
 * express-mongo-sanitize removed in Phase 1; assignment throws TypeError).
 * Node's querystring parser already produces string[] for repeated params
 * (e.g. condition=NEW&condition=GOOD), so arrays arrive naturally;
 * express-query-arrays is intentionally NOT added (fewer deps, one convention).
 *
 * On failure: 400 VALIDATION with the field → message map (§10 error shape).
 */

import { AppError } from './errorHandler.js';

export default function validateQuery(schema) {
  return async (req, _res, next) => {
    try {
      const raw = { ...req.query };

      // Wrap single scalars into arrays so `condition=NEW` and
      // `condition=NEW&condition=GOOD` (and `condition=NEW,GOOD` after the
      // split below) share one shape downstream.
      const multiValue = ['category', 'size', 'condition', 'tags'];
      for (const key of multiValue) {
        if (raw[key] !== undefined && !Array.isArray(raw[key])) {
          raw[key] = [raw[key]];
        }
        if (Array.isArray(raw[key])) {
          // Support `condition=NEW,GOOD` comma lists too.
          raw[key] = raw[key].flatMap((v) => String(v).split(',')).filter(Boolean);
        }
      }

      req.validatedQuery = await schema.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
      });
      next();
    } catch (err) {
      next(new AppError(400, 'VALIDATION', err.errors?.join(', ') || 'Invalid query parameters.'));
    }
  };
}
