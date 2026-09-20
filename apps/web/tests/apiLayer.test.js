/**
 * P5-T1 — API client layer tests. Following the established convention:
 * mock ONLY fetch (never the modules), assert real client code hits the
 * right endpoints/methods/payloads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, buildQuery, setAccessToken } from '../src/lib/api/client.js';
import * as itemsApi from '../src/lib/api/items.js';
import * as swapsApi from '../src/lib/api/swaps.js';
import * as adminApi from '../src/lib/api/admin.js';

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
    vi.fn(async (url, init) => {
      fetchCalls.push({ url: String(url), init });
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

describe('buildQuery', () => {
  it('serializes arrays as repeated params (matches browseItemsSchema)', () => {
    const qs = buildQuery({ condition: ['NEW', 'GOOD'], page: 2, q: 'denim jacket' });
    expect(qs).toBe('?condition=NEW&condition=GOOD&page=2&q=denim+jacket'); // URLSearchParams space form
  });

  it('skips undefined/null/empty-string and empty arrays', () => {
    expect(buildQuery({ a: undefined, b: null, c: '', d: [], e: 0, f: false })).toBe(
      '?e=0&f=false'
    );
  });

  it('returns an empty string for an all-empty object', () => {
    expect(buildQuery({})).toBe('');
  });
});

describe('apiFetch query integration', () => {
  it('appends the built query to the request path', async () => {
    responses = { '/items': [jsonResponse(200, { items: [] })] };
    await apiFetch('/items', { query: { page: 3, pageSize: 20 } });
    expect(fetchCalls[0].url).toContain('/items?page=3&pageSize=20');
  });
});

describe('items client (§10 endpoints)', () => {
  it('list() GETs /items with filter params', async () => {
    responses = { '/items': [jsonResponse(200, { items: [], total: 0 })] };
    await itemsApi.list({ category: ['DRESSES'], q: 'red dress', page: 1 });
    expect(fetchCalls[0].url).toContain('/items?');
    expect(fetchCalls[0].url).toContain('category=DRESSES');
    expect(fetchCalls[0].url).toContain('q=red+dress');
    expect(fetchCalls[0].init.method).toBe('GET'); // apiFetch's explicit default
  });

  it('getOne() GETs /items/:id', async () => {
    responses = { '/items/abc': [jsonResponse(200, { item: {} })] };
    await itemsApi.getOne('abc');
    expect(fetchCalls[0].url).toContain('/items/abc');
  });

  it('create() POSTs JSON', async () => {
    responses = { '/items': [jsonResponse(201, { item: { _id: 'x' } })] };
    await itemsApi.create({ title: 'New jacket' });
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ title: 'New jacket' });
  });

  it('update() PATCHes and remove() DELETEs /items/:id', async () => {
    responses = { '/items/abc': [jsonResponse(200, { item: {} }), jsonResponse(204)] };
    await itemsApi.update('abc', { title: 'Edited' });
    expect(fetchCalls[0].init.method).toBe('PATCH');

    const deleted = await itemsApi.remove('abc');
    expect(fetchCalls[1].init.method).toBe('DELETE');
    expect(deleted).toBeNull(); // 204 → null
  });

  it('uploadImages() sends multipart FormData without a manual Content-Type', async () => {
    responses = {
      '/items/images': [
        jsonResponse(201, [{ url: 'https://x/y.jpg', perceptualHash: 'ab'.repeat(8) }]),
      ],
    };
    const fakeFile = new File(['bits'], 'photo.jpg', { type: 'image/jpeg' });
    const out = await itemsApi.uploadImages([fakeFile]);

    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.body).toBeInstanceOf(FormData);
    expect(fetchCalls[0].init.headers['Content-Type']).toBeUndefined(); // browser sets boundary
    const sent = fetchCalls[0].init.body.get('images');
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe('photo.jpg');
    expect(out[0].perceptualHash).toBe('abababababababab');
  });

  it('classify() POSTs the imageUrl to /items/classify (P6-T5)', async () => {
    responses = {
      '/items/classify': [
        jsonResponse(200, {
          suggestion: {
            suggestedCategory: 'TOPS',
            suggestedCondition: 'NEW',
            suggestedPoints: 38,
            confidence: 0.95,
          },
        }),
      ],
    };
    const out = await itemsApi.classify('https://x.test/photo.jpg');

    expect(fetchCalls[0].url).toContain('/items/classify');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ imageUrl: 'https://x.test/photo.jpg' });
    expect(out.suggestion.suggestedPoints).toBe(38);
  });
});

describe('swaps client (§10 endpoints)', () => {
  it('createOnItem() POSTs to /items/:id/swap-requests', async () => {
    responses = { '/swap-requests': [jsonResponse(201, { swapRequest: {} })] };
    await swapsApi.createOnItem('item1', { type: 'POINTS_REDEMPTION' });
    expect(fetchCalls[0].url).toContain('/items/item1/swap-requests');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ type: 'POINTS_REDEMPTION' });
  });

  it('list() passes direction as a query param', async () => {
    responses = { '/swap-requests': [jsonResponse(200, { requests: [] })] };
    await swapsApi.list('incoming');
    expect(fetchCalls[0].url).toContain('/swap-requests?direction=incoming');
  });

  it('act() PATCHes { action } on /swap-requests/:id', async () => {
    responses = { '/swap-requests/r1': [jsonResponse(200, { swapRequest: {} })] };
    await swapsApi.act('r1', 'ACCEPT');
    expect(fetchCalls[0].init.method).toBe('PATCH');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ action: 'ACCEPT' });
  });
});

describe('admin client (§10 endpoints)', () => {
  it('pendingItems() GETs the queue with pagination', async () => {
    responses = { '/admin/items/pending': [jsonResponse(200, { items: [] })] };
    await adminApi.pendingItems({ page: 2 });
    expect(fetchCalls[0].url).toContain('/admin/items/pending?page=2');
  });

  it('moderate() PATCHes action + optional reason only when present', async () => {
    responses = { '/moderate': [jsonResponse(200, { item: {} }), jsonResponse(200, { item: {} })] };
    await adminApi.moderate('i1', 'REJECT', 'spam');
    const first = JSON.parse(fetchCalls[0].init.body);
    expect(first).toEqual({ action: 'REJECT', reason: 'spam' });

    await adminApi.moderate('i1', 'APPROVE');
    expect(JSON.parse(fetchCalls[1].init.body)).toEqual({ action: 'APPROVE' }); // no reason key
  });

  it('listUsers() passes filters; setBanned() PATCHes { banned }', async () => {
    responses = {
      '/admin/users': [jsonResponse(200, { users: [] }), jsonResponse(200, { user: {} })],
    };
    await adminApi.listUsers({ q: 'ann', role: 'USER', banned: false });
    expect(fetchCalls[0].url).toContain('/admin/users?');
    expect(fetchCalls[0].url).toContain('q=ann');

    await adminApi.setBanned('u1', true, 'fraud');
    expect(JSON.parse(fetchCalls[1].init.body)).toEqual({ banned: true, reason: 'fraud' });
  });

  it('bubbles the §10 error shape as ApiError (e.g. 403 for non-admin)', async () => {
    responses = {
      '/admin/items/pending': [
        jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'nope' } }),
      ],
    };
    await expect(adminApi.pendingItems({})).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});
