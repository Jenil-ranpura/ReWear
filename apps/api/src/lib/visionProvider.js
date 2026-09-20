/**
 * P6-T2 — Groq vision provider adapter (the concrete implementation behind
 * the P6-T1 `visionClassificationService` interface).
 *
 * Implements the provider shape: `classify(imageUrl) → Promise<result|null>`
 * — but unlike the service, THIS module returns null on ITS OWN failure
 * modes (transport, HTTP error, malformed body) so the service can still
 * distinguish timeout vs provider failure for logging while the outcome is
 * the same advisory-only null (§14.4/§16: never blocks listing).
 *
 * Groq specifics (verified against console.groq.com/docs, Sept 2026):
 * - OpenAI-compatible chat.completions at https://api.groq.com/openai/v1
 * - Vision models are MULTIMODAL CHAT models, not dedicated classifiers —
 *   the canonical llama-3.2 vision models are deprecated. Current picks:
 *   qwen/qwen3.6-27b (default; JSON mode with images supported).
 * - JSON mode (`response_format: { type: 'json_object' }`) is enforced with
 *   images → no brittle prose parsing.
 * - Image passed BY URL (our Cloudinary URL — no base64 round-trip).
 * - Model ID is pinned via GROQ_VISION_MODEL (Groq rotates their lineup —
 *   a hardcoded default goes stale silently; the env var makes it a one-line
 *   config fix with a loud failure instead).
 */

import env from '../config/env.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Provider-level request budget; the service's own 8s cap still applies. */
const GROQ_TIMEOUT_MS = 7000;

const SYSTEM_PROMPT = [
  'You are a clothing-listing classifier for a second-hand fashion exchange.',
  'Given one product photo, respond with ONLY a JSON object with exactly these keys:',
  '{"suggestedCategory": string, "suggestedCondition": string, "confidence": number}',
  `- suggestedCategory MUST be exactly one of: ${['JACKETS', 'DRESSES', 'COATS', 'TOPS', 'SHOES', 'ACCESSORIES', 'OTHER'].join(', ')} (OTHER only when nothing fits).`,
  `- suggestedCondition MUST be exactly one of: NEW, LIKE_NEW, GOOD, FAIR, WORN (assess visible wear: pilling, stains, fading, sole wear).`,
  '- confidence is your calibrated certainty from 0 to 1 (use low values for ambiguous or non-clothing images).',
].join('\n');

function isConfigured() {
  return Boolean(env.GROQ_API_KEY);
}

/**
 * One classification request. Resolves null on any transport/HTTP/parse
 * failure (advisory-only); the service layer owns timeout + normalization.
 *
 * @param {string} imageUrl — publicly fetchable image URL
 * @returns {Promise<{suggestedCategory: string, suggestedCondition: string,
 *   confidence: number} | null>}
 */
export async function classify(imageUrl) {
  if (!isConfigured()) return null;

  let response;
  try {
    response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      body: JSON.stringify({
        model: env.GROQ_VISION_MODEL,
        temperature: 0, // classification, not creativity — deterministic-ish
        max_completion_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Classify this clothing item for a second-hand listing.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
  } catch {
    return null; // network error, DNS, or our own AbortSignal timeout
  }

  if (!response.ok) {
    return null; // 401 bad key, 429 rate limit, 4xx/5xx — advisory-only
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return null;

  try {
    const parsed = JSON.parse(content);
    return {
      suggestedCategory: parsed?.suggestedCategory,
      suggestedCondition: parsed?.suggestedCondition,
      confidence: parsed?.confidence,
    };
  } catch {
    return null; // JSON mode violations surface here
  }
}

/** Identity metadata for logging/tests. */
export const groqProvider = {
  name: 'groq',
  model: () => env.GROQ_VISION_MODEL,
  isConfigured,
  classify,
};

export default groqProvider;
