/**
 * Phone validation (user-requested contact-reveal scope addition).
 *
 * "Best validation possible" = THREE independent layers, because each catches
 * what the others can't:
 *
 * 1. STRUCTURE — a strict charset/length gate. Cheap, runs first, and bounds
 *    what reaches libphonenumber (it throws on garbage input shapes).
 * 2. JUNK HEURISTICS — numbers that are format-plausible but obviously fake:
 *    all-same-digit (7777777777), sequential runs (1234567890, 2345678901),
 *    and repeated blocks (1234123412). libphonenumber ACCEPTS some of these
 *    (e.g. 9999999999 IS a format-valid Indian mobile) — only heuristics
 *    catch them.
 * 3. NUMBERING-PLAN REALITY — libphonenumber-js validates against actual
 *    country plans: 1234567890 fails as a US number (area code 123 doesn't
 *    exist) AND as an Indian one (mobiles start 6-9). This is the layer that
 *    makes "user or owner can't give 1234567890" literally true.
 *
 * A country code is REQUIRED (no default-country guessing): without it,
 * "9876543210" is ambiguous across 20+ countries and a bare local number
 * can't become a dialable E.164. UIs must show the +CC hint (they do).
 *
 * Storage contract: values are normalized to E.164 (+919876543210) at the
 * service boundary via normalizePhone — `tel:` links and display just work.
 */

import { string } from 'yup';

import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Layer 1 — charset/length gate: optional +, then digits/spaces/()- only. */
const STRUCTURE_RE = /^\+?[0-9][0-9 ()-]{4,19}$/;

/** Layer 2a — the ENTIRE subscriber number is one repeated digit (7777777777). */
function isAllSameDigit(digits) {
  return digits.length >= 5 && /^(\d)\1+$/.test(digits);
}

/**
 * Layer 2b — the ENTIRE subscriber number is one consecutive ascending or
 * descending run (1234567890, 9876543210). Deliberately WHOLE-number: real
 * numbers legitimately CONTAIN long runs (9876543211 is an allocatable Indian
 * mobile), so partial-run matching would reject genuine users.
 */
function isFullySequential(digits) {
  if (digits.length < 5) return false;
  const d = digits.split('').map(Number);
  const step = d[1] - d[0];
  if (Math.abs(step) !== 1) return false;
  return d.every((n, i) => i === 0 || n - d[i - 1] === step);
}

/** Layer 2c — the ENTIRE number is a 3+ digit block repeated (1234123412). */
function isRepeatedBlock(digits) {
  return digits.length >= 6 && /^(\d{3,})\1+$/.test(digits);
}

/**
 * True when `raw` is a REAL, dialable phone number. Empty/whitespace is NOT
 * this function's business — optional fields gate that before calling.
 */
export function isValidRealPhone(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || !STRUCTURE_RE.test(trimmed)) return false;

  const parsed = parsePhoneNumberFromString(trimmed);
  // undefined = no country inferable (missing/unknown +CC); false = country
  // known but the number doesn't fit its numbering plan.
  if (!parsed) return false;

  // Junk heuristics run on the NATIONAL (subscriber) number — including the
  // country code would mask them (917777777777 isn't all-same, but its
  // subscriber part 7777777777 is).
  const national = parsed.nationalNumber.toString();
  if (isAllSameDigit(national) || isFullySequential(national) || isRepeatedBlock(national)) {
    return false;
  }

  return parsed.isValid();
}

/** Normalize a VALID number to E.164; non-parsable input returns trimmed as-is (schemas reject it first). */
export function normalizePhone(raw) {
  const parsed = parsePhoneNumberFromString(String(raw ?? '').trim());
  return parsed ? parsed.number : String(raw ?? '').trim();
}

export const PHONE_ERROR = 'Enter a real phone number with country code (e.g. +91 98765 43210)';

/**
 * Optional phone field for Yup object schemas. `''`/undefined pass (the field
 * is optional); anything present must survive all three layers. Max 20 chars:
 * E.164 caps at 15 digits + '+', and display formats stay under it.
 */
export const optionalPhoneSchema = string()
  .trim()
  .max(20, PHONE_ERROR)
  .test('real-phone', PHONE_ERROR, (v) => v == null || v === '' || isValidRealPhone(v))
  .notRequired();

/** Required variant (same rules, must be present). */
export const requiredPhoneSchema = optionalPhoneSchema.test('phone-required', PHONE_ERROR, (v) =>
  Boolean(v && v.trim())
);
