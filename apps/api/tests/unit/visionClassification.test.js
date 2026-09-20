/**
 * P6-T1/T4 unit tests — pure logic, no DB, no network, no API key needed:
 * the provider is injected as a stub, so the classification CONTRACT is fully
 * testable before the Groq adapter (P6-T2) exists.
 */

import { jest } from '@jest/globals';

import {
  classify,
  setProvider,
  resetProvider,
  CONFIDENCE_FLOOR,
  CLASSIFY_TIMEOUT_MS,
} from '../../src/lib/visionClassificationService.js';
import {
  computeSuggestedPoints,
  BASE_POINTS,
  CONDITION_MULTIPLIERS,
} from '../../src/lib/pointsFormula.js';
import { ITEM_CATEGORIES, ITEM_CONDITION } from '@rewear/shared-schemas';

const URL = 'https://res.cloudinary.com/demo/image/upload/shirt.jpg';

function providerOk(overrides = {}) {
  return {
    classify: jest.fn().mockResolvedValue({
      suggestedCategory: 'TOPS',
      suggestedCondition: 'GOOD',
      confidence: 0.92,
      ...overrides,
    }),
  };
}

afterEach(() => {
  resetProvider();
});

describe('pointsFormula (P6-T4) — deterministic, AI-independent', () => {
  it('computes base × multiplier across the enum grid', () => {
    expect(computeSuggestedPoints('COATS', 'NEW')).toBe(Math.round(55 * 1.5)); // 83
    expect(computeSuggestedPoints('TOPS', 'GOOD')).toBe(25); // ×1.0 identity
    expect(computeSuggestedPoints('ACCESSORIES', 'WORN')).toBe(6); // 15 × 0.4
    expect(computeSuggestedPoints('DRESSES', 'LIKE_NEW')).toBe(54); // 45 × 1.2
  });

  it('rounds to integers and never returns less than 1', () => {
    expect(Number.isInteger(computeSuggestedPoints('JACKETS', 'FAIR'))).toBe(true);
    expect(computeSuggestedPoints('OTHER', 'WORN')).toBe(8); // 20 × 0.4
  });

  it('falls back to OTHER/GOOD defaults for unknown inputs (never throws)', () => {
    expect(computeSuggestedPoints('SPACESHIP', 'GOOD')).toBe(BASE_POINTS.OTHER);
    expect(computeSuggestedPoints('TOPS', 'MELTED')).toBe(BASE_POINTS.TOPS);
    expect(computeSuggestedPoints(undefined, undefined)).toBe(BASE_POINTS.OTHER);
  });

  it('covers every shared enum value (lockstep with @rewear/shared-schemas)', () => {
    for (const category of ITEM_CATEGORIES) {
      expect(BASE_POINTS[category]).toBeDefined();
      for (const condition of ITEM_CONDITION) {
        expect(CONDITION_MULTIPLIERS[condition]).toBeDefined();
        expect(computeSuggestedPoints(category, condition)).toBeGreaterThan(0);
      }
    }
  });
});

describe('visionClassificationService (P6-T1) — the classify() contract', () => {
  it('returns the normalized suggestion with FORMULA-computed points', async () => {
    setProvider(providerOk({ suggestedCategory: 'COATS', suggestedCondition: 'NEW' }));

    const result = await classify(URL);

    expect(result).toEqual({
      suggestedCategory: 'COATS',
      suggestedCondition: 'NEW',
      suggestedPoints: computeSuggestedPoints('COATS', 'NEW'), // 83 — never model-supplied
      confidence: 0.92,
    });
  });

  it('ignores any points value the provider hallucinated', async () => {
    setProvider(providerOk({ suggestedPoints: 99999 }));

    const result = await classify(URL);

    expect(result.suggestedPoints).toBe(computeSuggestedPoints('TOPS', 'GOOD')); // 25
    expect(result.suggestedPoints).not.toBe(99999);
  });

  it('resolves null when no provider is configured (advisory-only boot)', async () => {
    resetProvider();

    await expect(classify(URL)).resolves.toBeNull();
  });

  it('resolves null when the provider throws (network/500 — never propagates)', async () => {
    setProvider({ classify: jest.fn().mockRejectedValue(new Error('upstream 500')) });

    await expect(classify(URL)).resolves.toBeNull();
  });

  it('resolves null when the provider exceeds the 8s timeout', async () => {
    jest.useFakeTimers();
    try {
      setProvider({
        classify: jest.fn(
          () => new Promise((resolve) => setTimeout(() => resolve({}), CLASSIFY_TIMEOUT_MS + 1))
        ),
      });

      const pending = classify(URL);
      jest.advanceTimersByTime(CLASSIFY_TIMEOUT_MS);

      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('accepts a provider that answers quickly-but-not-instantly (no premature timeout)', async () => {
    setProvider({
      classify: jest.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  suggestedCategory: 'SHOES',
                  suggestedCondition: 'FAIR',
                  confidence: 0.8,
                }),
              30
            )
          )
      ),
    });

    const result = await classify(URL);

    expect(result).toMatchObject({ suggestedCategory: 'SHOES', suggestedCondition: 'FAIR' });
  });

  it('resolves null below the 0.5 confidence floor (§14.4)', async () => {
    setProvider(providerOk({ confidence: CONFIDENCE_FLOOR - 0.01 }));

    await expect(classify(URL)).resolves.toBeNull();
  });

  it('keeps a result exactly AT the floor (boundary: < floor, not <=)', async () => {
    setProvider(providerOk({ confidence: CONFIDENCE_FLOOR }));

    const result = await classify(URL);
    expect(result).not.toBeNull();
    expect(result.confidence).toBe(CONFIDENCE_FLOOR);
  });

  it('resolves null for out-of-enum category/condition (form would reject them anyway)', async () => {
    setProvider(providerOk({ suggestedCategory: 'ELECTRONICS' }));
    await expect(classify(URL)).resolves.toBeNull();

    setProvider(providerOk({ suggestedCondition: 'PRISTINE' }));
    await expect(classify(URL)).resolves.toBeNull();
  });

  it('resolves null on non-object or malformed provider output', async () => {
    setProvider({ classify: jest.fn().mockResolvedValue('a t-shirt, probably') });
    await expect(classify(URL)).resolves.toBeNull();

    setProvider({ classify: jest.fn().mockResolvedValue(null) });
    await expect(classify(URL)).resolves.toBeNull();

    setProvider({ classify: jest.fn().mockResolvedValue({ suggestedCategory: '  ' }) });
    await expect(classify(URL)).resolves.toBeNull();
  });

  it('trims surrounding whitespace in suggested values before validating', async () => {
    setProvider(providerOk({ suggestedCategory: ' COATS ', suggestedCondition: ' NEW ' }));

    const result = await classify(URL);

    expect(result.suggestedCategory).toBe('COATS');
    expect(result.suggestedCondition).toBe('NEW');
  });

  it('resolves null for missing/blank imageUrl without calling the provider', async () => {
    const spy = providerOk();
    setProvider(spy);

    await expect(classify('')).resolves.toBeNull();
    await expect(classify('   ')).resolves.toBeNull();
    await expect(classify(null)).resolves.toBeNull();
    expect(spy.classify).not.toHaveBeenCalled();
  });
});
