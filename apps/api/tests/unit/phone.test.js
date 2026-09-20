/**
 * Unit tests for the shared real-phone validator (user-requested contact
 * reveal). The POINT of this matrix: junk like "1234567890" can never reach
 * storage — from ANY layer (API schema and web form share these rules, §8).
 *
 * Layered defense under test (see shared-schemas/src/phone.js):
 *   structure gate → junk heuristics → libphonenumber numbering-plan reality.
 */

import { describe, expect, it } from '@jest/globals';

import { isValidRealPhone, normalizePhone, PHONE_ERROR } from '@rewear/shared-schemas';

describe('isValidRealPhone — the junk matrix', () => {
  const JUNK = [
    // The user's named enemy — sequential digits.
    '1234567890',
    '+11234567890', // even WITH a valid-looking +1 prefix
    '12345678901',
    // Sequential variants (7+-digit runs anywhere in the number).
    '2345678901',
    '9876543210',
    // All-same-digit.
    '7777777777',
    '+917777777777',
    '0000000000',
    '9999999999', // libphonenumber ALONE would accept this — heuristics kill it
    // Repeated blocks.
    '1234123412',
    '1231231230',
    // Structure failures.
    '12345', // too short
    '123456789012345678901234567890', // absurd length
    'abcdefghij', // not digits
    '12@#$5678', // bad charset
    '', // empty
    '   ',
    null,
    undefined,
    1234567890, // not a string
  ];

  it.each(JUNK)('rejects junk: %p', (input) => {
    expect(isValidRealPhone(input)).toBe(false);
  });

  const REAL = [
    '+919876543211', // India mobile, E.164 (ends 1 — not a sequential run)
    '+91 98765 43211', // India, pretty-spaced
    '+14155552671', // US (San Francisco)
    '+1 (415) 555-2671', // US, decorated
    '+442071838750', // UK landline
    '+817012345679', // Japan mobile (ends 9 — not sequential)
  ];

  it.each(REAL)('accepts a real number: %p', (input) => {
    expect(isValidRealPhone(input)).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('reduces decorated input to dialable E.164', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
  });

  it('passes through non-parsable input trimmed (schemas reject it before storage)', () => {
    expect(normalizePhone('  not-a-phone  ')).toBe('not-a-phone');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('PHONE_ERROR message', () => {
  it('demands the country code explicitly (no default-country guessing)', () => {
    expect(PHONE_ERROR).toMatch(/country code/i);
    // A real Indian mobile WITHOUT +91 must fail — ambiguity is the enemy.
    expect(isValidRealPhone('9876543210')).toBe(false);
  });
});
