/**
 * P5-T4 — Item form page tests. Mock ONLY `fetch` (suite convention): the
 * real API client, real AuthProvider (stubbed refresh/me like the detail-page
 * suite), and the real form run. Covers the §5.3 upload-first contract (the
 * POST /items body must carry server-returned {url, perceptualHash} records,
 * never File objects), client-side validation via the SHARED schema, the
 * duplicate-image advisory (§14.1 flag-only), the §5.9 field-preservation on
 * upload failure, edit-mode prefill + PATCH, the status guard, and delete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ItemFormPage from '../src/pages/ItemFormPage.jsx';
import { AuthProvider } from '../src/state/AuthContext.jsx';
import ToastProvider from '../src/components/shared/ToastProvider.jsx'; // P7-T3: pages call useToast
import { setAccessToken } from '../src/lib/api/client.js';

let fetchCalls = [];
let fetchImpl;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VIEWER = { _id: 'u-me', name: 'Ada Owner', role: 'USER', pointsBalance: 100 };

const SUGGESTION = {
  suggestedCategory: 'JACKETS',
  suggestedCondition: 'LIKE_NEW',
  suggestedPoints: 48, // formula: 40 × 1.2
  confidence: 0.9,
};

const EXISTING = {
  _id: 'i9',
  title: 'Vintage Denim Jacket',
  description: 'A well-loved denim jacket with brass buttons.',
  category: 'JACKETS',
  type: 'Jacket',
  size: 'M',
  condition: 'GOOD',
  tags: ['denim', 'vintage'],
  pointValue: 45,
  status: 'APPROVED',
  ownerId: 'u-me',
  images: [{ url: 'https://x.test/a.jpg', isPrimary: true, perceptualHash: 'aaaa1111bbbb2222' }],
  owner: { _id: 'u-me', name: 'Ada Owner' },
};

function makeFetch({
  item,
  imagesResponse,
  createResponse,
  updateResponse,
  deleteStatus = 204,
  classifyResponse,
} = {}) {
  return (u, init = {}) => {
    // NOTE: more specific routes first — /items/images and /items/i9 shadow.
    if (u.includes('/auth/refresh') || u.includes('/auth/me')) {
      return u.includes('/auth/refresh')
        ? jsonResponse(200, { accessToken: 't' })
        : jsonResponse(200, { user: VIEWER });
    }
    if (u.includes('/items/classify')) {
      return classifyResponse ?? jsonResponse(200, { suggestion: SUGGESTION });
    }
    if (u.includes('/items/images')) {
      return (
        imagesResponse ??
        jsonResponse(201, {
          images: [
            { url: 'https://x.test/up1.jpg', perceptualHash: 'ffff0000eeee1111', isPrimary: true },
          ],
        })
      );
    }
    if (u.includes('/items/i9')) {
      if (init.method === 'PATCH')
        return (
          updateResponse ?? jsonResponse(200, { item: { ...EXISTING, ...JSON.parse(init.body) } })
        );
      if (init.method === 'DELETE')
        return deleteStatus === 204 ? jsonResponse(204, null) : deleteStatus;
      if (item === undefined) return jsonResponse(200, { item: EXISTING });
      if (item === null)
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Item not found.' } });
      return jsonResponse(200, { item });
    }
    if (u.match(/\/items\/?$/)) {
      return (
        createResponse ??
        jsonResponse(201, { item: { _id: 'new1', title: 'T' }, duplicateImageFlagged: false })
      );
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
  };
}

beforeEach(() => {
  fetchCalls = [];
  setAccessToken(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = String(url);
      fetchCalls.push({ url: u, init });
      return fetchImpl(u, init);
    })
  );
});

afterEach(() => {
  setAccessToken(null);
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderForm({ route = '/items/new', path = '/items/new' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path={path} element={<ItemFormPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Fill the whole form with valid values (post-upload state). */
async function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Wool Winter Coat' } });
  fireEvent.change(screen.getByLabelText(/^description/i), {
    target: { value: 'A warm wool coat, gently worn for one winter only.' },
  });
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'COATS' } });
  fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Coat' } });
  fireEvent.change(screen.getByLabelText(/^size/i), { target: { value: 'L' } });
  fireEvent.change(screen.getByLabelText(/condition/i), { target: { value: 'GOOD' } });
  // pointValue is NOT typed (Session 13): it is read-only and derived —
  // COATS × GOOD → 55 by the time the form is filled.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled()
  );
}

async function uploadOne() {
  const file = new File(['fake'], 'coat.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('image-input'), { target: { files: [file] } });
  await screen.findByAltText('Photo 1 of 1');
}

describe('ItemFormPage — create mode (§5.3 upload-first)', () => {
  it('uploads immediately on file pick and POSTs server-returned image records', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();
    // The upload call happened BEFORE any submit: §5.3 upload → create.
    expect(fetchCalls.some((c) => c.url.includes('/items/images'))).toBe(true);

    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    await screen.findByText(/submitted for review/i);
    const createCall = fetchCalls.find(
      (c) => c.url.match(/\/items\/?$/) && c.init.method === 'POST'
    );
    expect(createCall).toBeDefined();
    const body = JSON.parse(createCall.init.body);
    expect(body.images).toEqual([
      { url: 'https://x.test/up1.jpg', isPrimary: true, perceptualHash: 'ffff0000eeee1111' },
    ]);
    expect(body.images[0]).not.toBeInstanceOf(File);
    expect(body.status).toBeUndefined(); // never client-settable (§14.1)
    expect(body.tags).toEqual([]); // default
  });

  it('shows the §5.3 success panel and the §14.1 duplicate-image advisory (flag-only)', async () => {
    fetchImpl = makeFetch({
      createResponse: jsonResponse(201, {
        item: { _id: 'n1', title: 'X' },
        duplicateImageFlagged: true,
      }),
    });
    renderForm();

    await uploadOne();
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(await screen.findByText(/submitted for review/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/similar to an existing listing/i);
  });

  it('blocks submit without images (client-side, no POST) and surfaces upload errors without losing fields (§5.9)', async () => {
    fetchImpl = makeFetch({
      imagesResponse: jsonResponse(503, {
        error: {
          code: 'IMAGE_SERVICE_UNAVAILABLE',
          message: 'Image uploads are not configured on this server.',
        },
      }),
    });
    renderForm();

    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/add at least one photo/i);
    expect(fetchCalls.some((c) => c.url.match(/\/items\/?$/) && c.init.method === 'POST')).toBe(
      false
    );

    // Now try an upload that FAILS: the typed fields must survive (§5.9).
    fireEvent.change(screen.getByTestId('image-input'), {
      target: { files: [new File(['x'], 'coat.jpg', { type: 'image/jpeg' })] },
    });
    // Wait on the NEW text (the stale form alert still exists momentarily).
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
    // Exactly ONE alert: the stale "add at least one photo" error yielded to
    // the uploader's own message (§5.9 — one clear message, not two).
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByLabelText(/title/i)).toHaveValue('Wool Winter Coat');

    // Failed upload must not have added an image.
    expect(screen.queryByAltText(/photo 1 of/i)).not.toBeInTheDocument();
  });

  it('rejects a wrong-type file and an oversized file client-side without an upload call', async () => {
    fetchImpl = makeFetch();
    renderForm();

    fireEvent.change(screen.getByTestId('image-input'), {
      target: { files: [new File(['x'], 'virus.exe', { type: 'application/x-msdownload' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/jpeg, png, or webp/i);
    expect(fetchCalls.some((c) => c.url.includes('/items/images'))).toBe(false);

    const big = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [big] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/larger than 5mb/i);
    expect(fetchCalls.some((c) => c.url.includes('/items/images'))).toBe(false);
  });

  it('validates fields through the SHARED schema (min lengths) before any submit', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(await screen.findByText(/title must be at least 3 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/description must be at least 10 characters/i)).toBeInTheDocument();
    // pointValue can no longer be client-invalidated by typing: the field is
    // read-only and formula-derived (Session 13) — nothing to type wrong.
    expect(fetchCalls.some((c) => c.url.match(/\/items\/?$/) && c.init.method === 'POST')).toBe(
      false
    );
  });

  it('maps a server VALIDATION error onto the alert banner', async () => {
    fetchImpl = makeFetch({
      createResponse: jsonResponse(400, {
        error: { code: 'VALIDATION', message: 'The submitted data is invalid.' },
      }),
    });
    renderForm();

    await uploadOne();
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/submitted data is invalid/i);
    // Form stays usable for correction.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });
});

describe('ItemFormPage — AI suggestion (P6-T5, §14.4/§16 advisory-only)', () => {
  it('fires classify on upload and pre-fills category/condition/pointValue with AI-suggested tags', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();

    // Pre-fill lands with the §12 "AI suggested" tags.
    await waitFor(() => {
      expect(screen.getByLabelText(/category/i)).toHaveValue('JACKETS');
    });
    expect(screen.getByLabelText(/condition/i)).toHaveValue('LIKE_NEW');
    // pointValue follows the FORMULA (40 × 1.2 = 48) but carries NO AI tag —
    // it is derived, not suggested (Session 13).
    expect(screen.getByLabelText(/point value/i)).toHaveValue(48);
    expect(screen.getByTestId('ai-tag-category')).toBeInTheDocument();
    expect(screen.getByTestId('ai-tag-condition')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-tag-pointValue')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/point value/i)).toHaveAttribute('readOnly');
    // Form never locked: submit stays available throughout.
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled();

    // Exactly ONE classify call per batch, carrying the uploaded URL.
    const classifyCalls = fetchCalls.filter((c) => c.url.includes('/items/classify'));
    expect(classifyCalls).toHaveLength(1);
    expect(JSON.parse(classifyCalls[0].init.body)).toEqual({
      imageUrl: 'https://x.test/up1.jpg',
    });
  });

  it('auto-recalculates point value when the user picks category/condition (formula, override included)', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();
    await waitFor(() => expect(screen.getByLabelText(/point value/i)).toHaveValue(48));

    // User re-picks both: formula recalculates live from the §14.4 table.
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'COATS' } });
    fireEvent.change(screen.getByLabelText(/condition/i), { target: { value: 'GOOD' } });
    expect(screen.getByLabelText(/point value/i)).toHaveValue(55); // 55 × 1.0

    // The field is READ-ONLY (Session 13): typing 3000 is impossible. The
    // fireEvent path bypasses readOnly in jsdom, so assert the attribute.
    expect(screen.getByLabelText(/point value/i)).toHaveAttribute('readOnly');
    fireEvent.change(screen.getByLabelText(/point value/i), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText(/condition/i), { target: { value: 'WORN' } });
    expect(screen.getByLabelText(/point value/i)).toHaveValue(22); // 55 × 0.4 — recalculated, not 3000
  });

  it('category is a constrained dropdown (no free text) and submits pointValue (Session 12 payload regression)', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();
    await screen.findByTestId('ai-tag-category');

    const categorySelect = screen.getByLabelText(/category/i);
    expect(categorySelect.tagName).toBe('SELECT');
    // Every canonical option present; AI's JACKETS still selected after fill.
    for (const c of ['JACKETS', 'DRESSES', 'COATS', 'TOPS', 'SHOES', 'ACCESSORIES', 'OTHER']) {
      expect(within(categorySelect).getByRole('option', { name: c })).toBeInTheDocument();
    }
    expect(categorySelect).toHaveValue('JACKETS');

    // Session 12 payload regression + Session 13 derivation: pointValue must
    // still be IN the POST body (dropping it 400'd), but its value now comes
    // from the FORMULA, not the user — fillValidForm types 40, yet COATS ×
    // GOOD (55) is what ships because the picks recalculate the field.
    await fillValidForm();
    expect(screen.getByLabelText(/point value/i)).toHaveValue(55);
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
    await screen.findByText(/submitted for review/i);
    const createCall = fetchCalls.find(
      (c) => c.url.match(/\/items\/?$/) && c.init.method === 'POST'
    );
    const body = JSON.parse(createCall.init.body);
    expect(body.pointValue).toBe(55);
  });

  it('clears stale "required" errors from an earlier submit attempt when the AI fills the fields', async () => {
    // The reported bug: submit an empty form → "required" errors appear →
    // add a photo → the AI fills the fields → the stale errors on the FILLED
    // fields must vanish (they read as contradictions).
    fetchImpl = makeFetch();
    renderForm();

    // Submit with everything empty: RHF blocks and shows the field errors.
    // (pointValue is no longer user-required — Session 13 made it derived —
    // so the visible blockers are the category/condition enum rules + title.)
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
    expect(await screen.findByText(/category must be one of/i)).toBeInTheDocument();
    expect(screen.getByText(/condition must be one of/i)).toBeInTheDocument();

    await uploadOne();
    await waitFor(() => {
      expect(screen.getByLabelText(/category/i)).toHaveValue('JACKETS');
    });
    // The AI-filled fields' errors are gone; values are filled (points =
    // formula 40 × 1.2 = 48, not an AI-chosen number).
    expect(screen.queryByText(/category must be one of/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/condition must be one of/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/point value/i)).toHaveValue(48);
    // Untouched fields still show their (correct) errors — clearing is scoped.
    expect(screen.getByText(/title must be at least 3 characters/i)).toBeInTheDocument();
  });

  it('shows a scoped loading state while the suggestion is in flight (§23: form stays interactive)', async () => {
    // Deferred classify so the loading state is observable (instant mocks
    // resolve inside one act flush and the transient state never paints).
    let resolveClassify;
    fetchImpl = makeFetch({
      classifyResponse: new Promise((resolve) => {
        resolveClassify = () => resolve(jsonResponse(200, { suggestion: SUGGESTION }));
      }),
    });
    renderForm();

    await uploadOne();
    expect(await screen.findByTestId('ai-loading')).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toHaveValue(''); // not pre-filled yet

    resolveClassify();
    await waitFor(() => {
      expect(screen.getByLabelText(/category/i)).toHaveValue('JACKETS');
    });
    expect(screen.queryByTestId('ai-loading')).not.toBeInTheDocument();
  });

  it('degrades to manual when the AI returns suggestion null (200, no error UI)', async () => {
    fetchImpl = makeFetch({ classifyResponse: jsonResponse(200, { suggestion: null }) });
    renderForm();

    await uploadOne();

    await waitFor(() => {
      expect(screen.queryByTestId('ai-loading')).not.toBeInTheDocument();
    });
    // The degradation is VISIBLE but calm (§5.9): a hint, not an alert.
    expect(screen.getByTestId('ai-none')).toHaveTextContent(/fill the fields in manually/i);
    expect(screen.getByLabelText(/category/i)).toHaveValue('');
    expect(screen.getByLabelText(/point value/i)).toHaveValue(null);
    expect(screen.queryByTestId(/ai-tag-/)).not.toBeInTheDocument();
    // No error alert — advisory null is NOT a failure (§14.4).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('degrades to manual when the classify call itself fails (never blocks listing, §16)', async () => {
    fetchImpl = makeFetch({
      classifyResponse: jsonResponse(500, {
        error: { code: 'INTERNAL', message: 'boom' },
      }),
    });
    renderForm();

    await uploadOne();
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));

    // The listing flow proceeds normally despite the AI failure.
    expect(await screen.findByText(/submitted for review/i)).toBeInTheDocument();
    const createCall = fetchCalls.find(
      (c) => c.url.match(/\/items\/?$/) && c.init.method === 'POST'
    );
    expect(createCall).toBeDefined();
    // The failure surfaced NO AI error UI (advisory-only degradation).
    expect(screen.queryByTestId(/ai-tag-/)).not.toBeInTheDocument();
  });

  it('clears the AI-suggested tag on a field the user overrides (never locked, §13)', async () => {
    fetchImpl = makeFetch();
    renderForm();

    await uploadOne();
    await screen.findByTestId('ai-tag-category');

    // User overrides category → its tag retires; untouched fields keep theirs.
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'COATS' } });
    expect(screen.queryByTestId('ai-tag-category')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-tag-condition')).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toHaveValue('COATS');
  });

  it('does NOT fire classify in edit mode', async () => {
    fetchImpl = makeFetch();
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    await screen.findByText(/edit item/i);
    // The item load already happened; give any stray classify a chance to fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchCalls.some((c) => c.url.includes('/items/classify'))).toBe(false);
  });

  it('renders the fixed §14.4 formula table (base × multipliers, shown to the user)', async () => {
    fetchImpl = makeFetch();
    renderForm();

    const table = screen.getByTestId('points-formula-table');
    expect(table).toBeInTheDocument();
    // Spot-check the formula grid: JACKETS row = 40 base, LIKE_NEW ×1.2 → 48.
    const jacketsRow = within(table).getByText('JACKETS').closest('tr');
    expect(jacketsRow).toHaveTextContent('40');
    expect(jacketsRow).toHaveTextContent('48');
    // COATS × NEW = 55 × 1.5 = 83.
    const coatsRow = within(table).getByText('COATS').closest('tr');
    expect(coatsRow).toHaveTextContent('83');
  });
});

describe('ItemFormPage — uploader interactions (remove / set cover)', () => {
  /** Each upload call returns a DIFFERENT image (per-call-count mock). */
  function twoImageFetch() {
    let uploadCount = 0;
    return (u) => {
      if (u.includes('/auth/refresh') || u.includes('/auth/me')) {
        return u.includes('/auth/refresh')
          ? jsonResponse(200, { accessToken: 't' })
          : jsonResponse(200, { user: VIEWER });
      }
      if (u.includes('/items/images')) {
        uploadCount += 1;
        return jsonResponse(201, {
          images: [
            {
              url: `https://x.test/img${uploadCount}.jpg`,
              perceptualHash: `hash000000000000${uploadCount}`,
              isPrimary: true,
            },
          ],
        });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    };
  }

  async function uploadTwoImages() {
    fetchImpl = twoImageFetch();
    renderForm();
    fireEvent.change(screen.getByTestId('image-input'), {
      target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByAltText('Photo 1 of 1');
    fireEvent.change(screen.getByTestId('image-input'), {
      target: { files: [new File(['x'], 'b.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByAltText('Photo 2 of 2');
  }

  it('removes an image and moves the cover designation to the first remaining', async () => {
    await uploadTwoImages();

    // Remove the (first) cover image → remaining one must become the cover
    // (its own "set cover" button is disabled — it already IS the cover).
    fireEvent.click(screen.getByRole('button', { name: /remove photo 1/i }));
    expect(screen.getByAltText('Photo 1 of 1')).toHaveAttribute('src', 'https://x.test/img2.jpg');
    expect(screen.getByRole('button', { name: 'Set photo 1 as cover' })).toBeDisabled();

    // Remove the last one → the empty-state hint returns.
    fireEvent.click(screen.getByRole('button', { name: /remove photo 1/i }));
    expect(screen.queryByAltText(/photo 1 of/i)).not.toBeInTheDocument();
  });

  it('lets the owner re-designate the cover image', async () => {
    await uploadTwoImages();

    // First image was the cover; set the second as the new cover.
    fireEvent.click(screen.getByRole('button', { name: /set photo 2 as cover/i }));
    expect(screen.getByRole('button', { name: 'Set photo 2 as cover' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set photo 1 as cover' })).toBeEnabled();
  });
});

describe('ItemFormPage — edit mode', () => {
  it('prefills everything, echoes server image hashes, and PATCHes on save', async () => {
    fetchImpl = makeFetch();
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    expect(await screen.findByText(/edit item/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue('Vintage Denim Jacket');
    expect(screen.getByAltText('Photo 1 of 1')).toHaveAttribute('src', 'https://x.test/a.jpg');

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Vintage Denim Jacket — Mint' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const call = fetchCalls.find((c) => c.init.method === 'PATCH');
      expect(call).toBeDefined();
      const body = JSON.parse(call.init.body);
      expect(body.title).toBe('Vintage Denim Jacket — Mint');
      // The existing image's server hash is echoed back unchanged.
      expect(body.images).toEqual([
        { url: 'https://x.test/a.jpg', isPrimary: true, perceptualHash: 'aaaa1111bbbb2222' },
      ]);
      expect(body.status).toBeUndefined(); // not updatable via PATCH (§10)
    });
  });

  it('shows the guard panel for statuses outside PENDING/APPROVED and hides the form', async () => {
    fetchImpl = makeFetch({ item: { ...EXISTING, status: 'SWAPPED' } });
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    expect(await screen.findByText(/can't be edited/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
  });

  it('shows the 403 panel for non-owners and hides the form', async () => {
    fetchImpl = makeFetch({ item: { ...EXISTING, ownerId: 'u-someone-else' } });
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    expect(await screen.findByText(/only edit your own items/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
  });

  it('shows the human error state when the item cannot be loaded', async () => {
    fetchImpl = makeFetch({ item: null });
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/item not found/i);
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
  });

  it('deletes via the confirm dialog and redirects (dashboard nav not asserted here)', async () => {
    fetchImpl = makeFetch();
    renderForm({ route: '/items/i9/edit', path: '/items/:id/edit' });

    await screen.findByText(/edit item/i);
    fireEvent.click(screen.getByRole('button', { name: /delete listing/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      const call = fetchCalls.find((c) => c.init.method === 'DELETE');
      expect(call).toBeDefined();
      expect(call.url).toContain('/items/i9');
    });

    // P7-T3: the delete navigates away immediately — the toast carries the
    // outcome (soft delete → REMOVED) plus a link to the items list.
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByText(/listing removed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my items/i })).toHaveAttribute(
      'href',
      '/dashboard/items'
    );
  });
});
