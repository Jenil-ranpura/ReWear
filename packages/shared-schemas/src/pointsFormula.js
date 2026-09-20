/**
 * Deterministic point-value formula (implementation.md §14.4) — SHARED so the
 * web form can render the fixed, explainable tables to the user (§14.4: "the
 * multiplier table itself is fixed and shown to the user") while the API
 * recomputes suggestedPoints from the SAME tables (the AI never supplies
 * points — a hallucinating model cannot distort the economy).
 *
 * `suggestedPoints = basePoints[category] × conditionMultiplier[condition]`
 *
 * Deliberately PURE: no IO, no AI, no randomness.
 */

import { ITEM_CATEGORIES, ITEM_CONDITION } from './constants.js';

/** Base points per category — bigger/seasonal garments are worth more. */
export const BASE_POINTS = Object.freeze({
  JACKETS: 40,
  DRESSES: 45,
  COATS: 55,
  TOPS: 25,
  SHOES: 30,
  ACCESSORIES: 15,
  OTHER: 20,
});

/** Condition multiplier table — §14.4's exact values. */
export const CONDITION_MULTIPLIERS = Object.freeze({
  NEW: 1.5,
  LIKE_NEW: 1.2,
  GOOD: 1.0,
  FAIR: 0.7,
  WORN: 0.4,
});

/** Fallback for unknown category input (never trust the model blindly). */
const DEFAULT_BASE = BASE_POINTS.OTHER;

/** Fallback for unknown condition input. */
const DEFAULT_MULTIPLIER = CONDITION_MULTIPLIERS.GOOD;

/**
 * Compute the suggested point value. Pure function: same inputs → same
 * output. Unknown/invalid category or condition falls back to the OTHER/GOOD
 * defaults rather than throwing (advisory-only surface).
 *
 * @param {string} category — canonical category (from ITEM_CATEGORIES)
 * @param {string} condition — canonical condition (from ITEM_CONDITION)
 * @returns {number} integer point value ≥ 1
 */
export function computeSuggestedPoints(category, condition) {
  const base = BASE_POINTS[category] ?? DEFAULT_BASE;
  const multiplier = CONDITION_MULTIPLIERS[condition] ?? DEFAULT_MULTIPLIER;
  return Math.max(1, Math.round(base * multiplier));
}

/** Sanity guards: the tables and the shared enums stay in lockstep. */
for (const category of ITEM_CATEGORIES) {
  if (!(category in BASE_POINTS)) {
    throw new Error(`[pointsFormula] BASE_POINTS is missing canonical category ${category}`);
  }
}
for (const condition of ITEM_CONDITION) {
  if (!(condition in CONDITION_MULTIPLIERS)) {
    throw new Error(`[pointsFormula] CONDITION_MULTIPLIERS is missing ${condition}`);
  }
}
