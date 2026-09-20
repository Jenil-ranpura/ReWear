/**
 * P6-T1 — visionClassificationService interface (implementation.md §14.4/§16).
 *
 * THE CONTRACT: `classify(imageUrl) → Promise<{ suggestedCategory,
 * suggestedCondition, suggestedPoints, confidence } | null>`
 *
 * - Provider-agnostic: P6-T2's Groq adapter plugs in via the factory /
 *   `setProvider()`; the form flow never knows (or cares) which AI is behind
 *   it.
 * - ADVISORY ONLY (§14.4/§16): ANY failure — no provider configured, network
 *   error, timeout, unparseable output, out-of-enum suggestion — resolves to
 *   `null` and the caller lets the user fill the form manually. classify()
 *   NEVER throws and NEVER blocks submission.
 * - §14.4's division of labor is enforced HERE, not by hope: the model may
 *   suggest category/condition, but suggestedPoints ALWAYS comes from the
 *   deterministic pointsFormula — a hallucinating model cannot distort the
 *   economy. Confidence < CONFIDENCE_FLOOR (0.5) → null per §14.4.
 */

import { ITEM_CATEGORIES, ITEM_CONDITION } from '@rewear/shared-schemas';

import logger from './logger.js';
import { computeSuggestedPoints } from './pointsFormula.js';

/** §14.4: "low confidence (confidence < 0.5) → return null". */
export const CONFIDENCE_FLOOR = 0.5;

/** §14.4: classification runs behind an 8-second timeout. */
export const CLASSIFY_TIMEOUT_MS = 8000;

/**
 * The active provider. `null` = no AI configured — classify() resolves null
 * (advisory-only degradation, never an error).
 */
let provider = null;

/** Register the concrete provider adapter (P6-T2). Returns the previous one. */
export function setProvider(next) {
  const previous = provider;
  provider = next;
  return previous;
}

/**
 * Race a promise against a timeout. Rejects with a tagged TimeoutError so
 * classify() can log the REAL failure cause (timeout vs network vs parse).
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`classification timed out after ${ms}ms`);
      err.code = 'CLASSIFY_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Normalize the provider's raw output into the contract shape.
 * - category/condition are validated against the shared enums; an out-of-list
 *   value fails the WHOLE result (the form would reject it anyway — better to
 *   degrade to null so the UI never shows a suggestion that cannot be used).
 * - suggestedPoints is recomputed from the formula (never taken from the
 *   model) so the value is always explainable (§14.4).
 * - confidence is clamped to [0, 1].
 * Throws on any invalid input — classify() catches and converts to null.
 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('provider returned a non-object');
  }

  const category = typeof raw.suggestedCategory === 'string' ? raw.suggestedCategory.trim() : '';
  if (!ITEM_CATEGORIES.includes(category)) {
    throw new TypeError(`provider suggested out-of-enum category "${category}"`);
  }

  const condition = typeof raw.suggestedCondition === 'string' ? raw.suggestedCondition.trim() : '';
  if (!ITEM_CONDITION.includes(condition)) {
    throw new TypeError(`provider suggested out-of-enum condition "${condition}"`);
  }

  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0));

  return {
    suggestedCategory: category,
    suggestedCondition: condition,
    suggestedPoints: computeSuggestedPoints(category, condition),
    confidence,
  };
}

/**
 * Classify the clothing item shown in `imageUrl`.
 *
 * @param {string} imageUrl — a publicly fetchable image URL (the Cloudinary
 *   URL returned by POST /items/images).
 * @returns {Promise<{suggestedCategory: string, suggestedCondition: string,
 *   suggestedPoints: number, confidence: number} | null>}
 *   The suggestion, or null when: no provider is configured, the call fails
 *   or times out (8s), the output is unparseable, the suggestion is
 *   out-of-enum, or confidence < 0.5. NEVER throws.
 */
export async function classify(imageUrl) {
  if (!provider) {
    logger.info('classify_skipped', { reason: 'no vision provider configured' });
    return null;
  }
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return null;
  }

  try {
    const raw = await withTimeout(
      Promise.resolve(provider.classify(imageUrl.trim())),
      CLASSIFY_TIMEOUT_MS
    );
    const result = normalize(raw);
    if (result.confidence < CONFIDENCE_FLOOR) {
      logger.info('classify_low_confidence', { confidence: result.confidence, imageUrl });
      return null;
    }
    logger.info('classify_ok', {
      category: result.suggestedCategory,
      condition: result.suggestedCondition,
      points: result.suggestedPoints,
      confidence: result.confidence,
    });
    return result;
  } catch (err) {
    // §16 advisory-only: log at warn and degrade to null — the user simply
    // fills the form manually. The create flow must never see this error.
    logger.warn('classify_failed', { error: err?.message ?? String(err), imageUrl });
    return null;
  }
}

/** Test seam: restore the no-provider state. */
export function resetProvider() {
  provider = null;
}
