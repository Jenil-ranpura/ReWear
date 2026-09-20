/**
 * Jest environment bootstrap: tests run without a real .env, so provide safe
 * test defaults BEFORE any module import touches config/env.js.
 * In test mode the config module skips the strict secret checks.
 * (.mjs — the api package runs Jest in native ESM mode; no Babel.)
 */

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-0123456789abcdef0123456789abcdef';
