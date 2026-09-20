/**
 * P1-T2 — Config module.
 * Loads and validates environment variables at boot; fails fast (throws) when
 * a required variable is missing or invalid (implementation.md §27 P1-T2).
 *
 * Loaded via `node --env-file-if-exists=.env` (npm scripts) and/or dotenv.
 * dotenv is pointed at apps/api/.env BY ABSOLUTE PATH (resolved from this
 * module's location) so the server boots no matter which directory the
 * process is started from — `node server.js` from src/ used to fail with a
 * confusing "Missing JWT_ACCESS_SECRET" because plain `import 'dotenv/config'`
 * resolves .env relative to the CURRENT WORKING DIRECTORY. dotenv never
 * overrides already-set variables, so the two loading paths stay compatible.
 *
 * Advisory-only services (Cloudinary, vision API) are OPTIONAL at boot —
 * their absence must never block the core flow (implementation.md §14.4, §16).
 */

import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        'Copy apps/api/.env.example to apps/api/.env and fill it in.'
    );
  }
  return value.trim();
}

function optional(name, fallback = undefined) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const NODE_ENV = optional('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

// JWT secrets: required in every environment — there is no valid mode in which
// the API should boot without them (tokens would be unsigned/unsecure).
const JWT_ACCESS_SECRET = required('JWT_ACCESS_SECRET');
const JWT_REFRESH_SECRET = required('JWT_REFRESH_SECRET');

// §11 (user request): the WHOLE login session is a FIXED window — after
// SESSION_TTL_MINUTES from login the refresh cookie, the stored refresh token
// and the UI session all die (automatic logout). Refresh rotates the token
// but never moves the deadline. Fractional minutes are allowed so the e2e
// stack can boot with a short window (e.g. SESSION_TTL_MINUTES=0.2).
const SESSION_TTL_MINUTES = Number.parseFloat(optional('SESSION_TTL_MINUTES', '15'));
if (!(SESSION_TTL_MINUTES > 0)) {
  throw new Error('[config] SESSION_TTL_MINUTES must be a number > 0 (minutes).');
}

if (!isTest) {
  if (JWT_ACCESS_SECRET.length < 32 || JWT_REFRESH_SECRET.length < 32) {
    throw new Error(
      '[config] JWT secrets must be at least 32 chars (generate: openssl rand -hex 32).'
    );
  }
  if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) {
    throw new Error('[config] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.');
  }
}

const env = {
  NODE_ENV,
  isProduction,
  isTest,
  PORT: Number.parseInt(optional('PORT', '4000'), 10),

  // MONGODB_URI is NOT required here: in tests the connection is provided by
  // mongodb-memory-server (§17), and server.js only validates it when actually
  // starting a real server. P2-T2's lib/db.js owns the connection itself.
  MONGODB_URI: optional('MONGODB_URI'),

  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_TTL: optional('JWT_ACCESS_TTL', '15m'),
  SESSION_TTL_MINUTES,

  // Advisory-only integrations — optional by design (§14.4/§16).
  CLOUDINARY_URL: optional('CLOUDINARY_URL'),
  VISION_API_PROVIDER: optional('VISION_API_PROVIDER'),
  VISION_API_KEY: optional('VISION_API_KEY'),

  // Groq (P6-T2) — the concrete vision provider behind
  // visionClassificationService. Optional at boot: without a key, classify()
  // resolves null and the item form is simply fully manual.
  GROQ_API_KEY: optional('GROQ_API_KEY'),
  GROQ_VISION_MODEL: optional('GROQ_VISION_MODEL', 'qwen/qwen3.8-27b'),

  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // §11: auth endpoints are rate-limited per IP (credential-stuffing mitigation).
  AUTH_RATE_LIMIT_MAX: Number.parseInt(optional('AUTH_RATE_LIMIT_MAX', '20'), 10),
  AUTH_RATE_LIMIT_WINDOW_MS: Number.parseInt(optional('AUTH_RATE_LIMIT_WINDOW_MS', '900000'), 10), // 15 min

  // §11/P7-T2: write endpoints are rate-limited per USER (the limiter keys on
  // the authenticated user id, so these are per-account budgets, not per-IP).
  // writeLimiter (items + swaps writes) and classifyLimiter (the vision-API
  // call — tightest bucket, own budget) share this window by default.
  WRITE_RATE_LIMIT_MAX: Number.parseInt(optional('WRITE_RATE_LIMIT_MAX', '30'), 10),
  CLASSIFY_RATE_LIMIT_MAX: Number.parseInt(optional('CLASSIFY_RATE_LIMIT_MAX', '10'), 10),
  WRITE_RATE_LIMIT_WINDOW_MS: Number.parseInt(optional('WRITE_RATE_LIMIT_WINDOW_MS', '60000'), 10), // 1 min
};

export default env;
