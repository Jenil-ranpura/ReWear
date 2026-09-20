import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiFetch,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
} from '../src/lib/api/client.js';

/**
 * Fetch stub keyed by path segment. Each value is an array of responses
 * consumed in order (so tests can script "401 then refresh then 200").
 */
let fetchCalls = [];
let responses = {};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function stubFetch() {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      fetchCalls.push(String(url));
      for (const [fragment, queue] of Object.entries(responses)) {
        if (String(url).includes(fragment) && queue.length > 0) {
          return queue.shift();
        }
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no stub' } });
    })
  );
}

beforeEach(() => {
  setAccessToken(null);
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client refresh logic (P3-T7 hardening)', () => {
  it('transparently refreshes once and retries when an access token expires', async () => {
    setAccessToken('stale-token');
    responses = {
      '/items': [
        jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'token expired' } }),
        jsonResponse(200, { items: [] }),
      ],
      '/auth/refresh': [jsonResponse(200, { accessToken: 'fresh-token' })],
    };

    const data = await apiFetch('/items');

    expect(data).toEqual({ items: [] });
    expect(getAccessToken()).toBe('fresh-token');
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[0]).toContain('/items');
    expect(fetchCalls[1]).toContain('/auth/refresh');
    expect(fetchCalls[2]).toContain('/items');
  });

  it('dedupes concurrent refresh calls to ONE request (single-use cookie safety)', async () => {
    let resolveRefresh;
    responses = {
      '/auth/refresh': [
        new Promise((resolve) => {
          resolveRefresh = () => resolve(jsonResponse(200, { accessToken: 'tok-1' }));
        }),
      ],
    };

    const p1 = refreshAccessToken();
    const p2 = refreshAccessToken();
    const p3 = refreshAccessToken();

    resolveRefresh();
    const tokens = await Promise.all([p1, p2, p3]);

    expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(fetchCalls.filter((u) => u.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('never auto-retries /auth/* requests (a failed login stays one request)', async () => {
    responses = {
      '/auth/login': [
        jsonResponse(401, {
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
        }),
      ],
    };

    await expect(
      apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.dev', password: 'x' } })
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchCalls).toHaveLength(1);
  });

  it('does not refresh for 401s that are not token-expiry errors', async () => {
    setAccessToken('tok');
    responses = {
      '/items': [jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'nope' } })],
      '/auth/refresh': [jsonResponse(200, { accessToken: 'should-not-happen' })],
    };
    // Simulate a non-expiry 401: a forbidden-but-401-shaped error is not in the
    // retry set, so only the original call happens.
    responses['/items'] = [
      jsonResponse(401, { error: { code: 'SESSION_REVOKED', message: 'revoked' } }),
    ];

    await expect(apiFetch('/items')).rejects.toBeInstanceOf(ApiError);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/items');
  });

  it('restores correctly after a failed refresh attempt (failure not cached)', async () => {
    responses = {
      '/auth/refresh': [
        jsonResponse(401, { error: { code: 'INVALID_REFRESH', message: 'Session expired.' } }),
        jsonResponse(200, { accessToken: 'tok-2' }),
      ],
    };

    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'INVALID_REFRESH' });
    await expect(refreshAccessToken()).resolves.toBe('tok-2');
    expect(fetchCalls.filter((u) => u.includes('/auth/refresh'))).toHaveLength(2);
  });
});
