/**
 * P6-T4 — Deterministic point-value formula (implementation.md §14.4).
 *
 * MOVED to packages/shared-schemas/src/pointsFormula.js (Session 10): the web
 * form must render the SAME fixed tables the API computes suggestedPoints
 * from (§14.4: "the multiplier table itself is fixed and shown to the user"),
 * and a shared module is the one place that can never drift. This file stays
 * as the api-side re-export so existing imports (visionClassificationService,
 * unit tests) keep working unchanged.
 */

export { BASE_POINTS, CONDITION_MULTIPLIERS, computeSuggestedPoints } from '@rewear/shared-schemas';
