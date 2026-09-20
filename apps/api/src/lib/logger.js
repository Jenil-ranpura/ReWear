/**
 * P1-T3 — Structured JSON logger (implementation.md §20).
 * Zero-dependency, one JSON object per line: { time, level, msg, ...meta }.
 *
 * Security: secrets are redacted recursively (password, passwordHash,
 * authorization header, token fields) per §15 "Logging" row.
 *
 * Debt note (progress.md): if structured-logging needs grow (child loggers,
 * transports), replace with pino behind this same interface.
 */

const REDACTED = '[REDACTED]';
const REDACT_KEY_PATTERN = /password|passwordhash|authorization|cookie|token|secret|api[_-]?key/i;
const REDACTED_PLACEHOLDERS = new Set([REDACTED, '***']);
const MAX_DEPTH = 6;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] =
        val !== null &&
        typeof val === 'string' &&
        (REDACTED_PLACEHOLDERS.has(val) || REDACT_KEY_PATTERN.test(key))
          ? REDACTED
          : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level, msg, meta) {
  const entry = { time: new Date().toISOString(), level, msg };
  if (meta !== undefined) Object.assign(entry, redact(meta));
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') write('debug', msg, meta);
  },
};

export default logger;
