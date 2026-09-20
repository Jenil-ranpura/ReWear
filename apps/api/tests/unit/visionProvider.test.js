/**
 * P6-T2 unit tests — the Groq adapter with mocked `fetch` (no real key, no
 * network). Proves the request SHAPE (model, JSON mode, image_url) and every
 * failure mode resolving to null (advisory-only contract).
 */

import { jest } from '@jest/globals';

import env from '../../src/config/env.js';

describe('groq vision provider (P6-T2)', () => {
  const ORIGINAL_KEY = env.GROQ_API_KEY;
  const ORIGINAL_MODEL = env.GROQ_VISION_MODEL;

  let groqProvider;

  beforeAll(async () => {
    ({ default: groqProvider } = await import('../../src/lib/visionProvider.js'));
  });

  beforeEach(() => {
    // env.js SNAPSHOTS process.env at import time — mutating process.env in a
    // test would not reach the adapter. Mutate the env object itself.
    env.GROQ_API_KEY = 'test-key-123';
    env.GROQ_VISION_MODEL = 'qwen/qwen3.6-27b';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    env.GROQ_API_KEY = ORIGINAL_KEY;
    env.GROQ_VISION_MODEL = ORIGINAL_MODEL;
  });

  const okResponse = (content) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
  });

  function mockFetchOnce(response) {
    return jest.spyOn(global, 'fetch').mockResolvedValue(response);
  }

  it('sends the pinned model, JSON mode, and the image by URL; returns parsed fields', async () => {
    const fetchMock = mockFetchOnce(
      okResponse({ suggestedCategory: 'COATS', suggestedCondition: 'FAIR', confidence: 0.87 })
    );

    const result = await groqProvider.classify('https://cdn.test/coat.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key-123');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen/qwen3.6-27b');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          image_url: { url: 'https://cdn.test/coat.jpg' },
        }),
      ])
    );
    // The prompt constrains the model to the canonical enums.
    expect(body.messages[0].content).toContain('JACKETS');
    expect(body.messages[0].content).toContain('WORN');

    expect(result).toEqual({
      suggestedCategory: 'COATS',
      suggestedCondition: 'FAIR',
      confidence: 0.87,
    });
  });

  it('returns null when GROQ_API_KEY is absent — without calling fetch', async () => {
    env.GROQ_API_KEY = '';
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on transport failure (network down / aborted timeout)', async () => {
    mockFetchOnce(Promise.reject(new Error('getaddrinfo ENOTFOUND')));

    await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();
  });

  it('returns null on HTTP errors (401 bad key, 429 rate limit, 500)', async () => {
    for (const status of [401, 429, 500]) {
      mockFetchOnce({ ok: false, status });

      await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();
    }
  });

  it('returns null when the body is not JSON (HTML error pages, truncation)', async () => {
    mockFetchOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });

    await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();
  });

  it('returns null when the content is not a JSON object (JSON-mode violation)', async () => {
    mockFetchOnce(okResponse(undefined)); // content serializes to undefined → not valid JSON object
    await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();

    mockFetchOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'It looks like a coat to me!' } }] }),
    });
    await expect(groqProvider.classify('https://cdn.test/x.jpg')).resolves.toBeNull();
  });

  it('reports its identity and configuration for logging/tests', () => {
    env.GROQ_API_KEY = 'k';
    expect(groqProvider.isConfigured()).toBe(true);
    expect(groqProvider.name).toBe('groq');
    expect(groqProvider.model()).toBe('qwen/qwen3.6-27b');

    env.GROQ_API_KEY = '';
    expect(groqProvider.isConfigured()).toBe(false);
  });
});
