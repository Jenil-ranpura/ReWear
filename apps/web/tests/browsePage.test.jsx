/**
 * P5-T2 — Browse page tests. Mock ONLY fetch; drive the real page. Covers:
 * URL-driven filters (the §5.4 contract), chip toggling (multi-select),
 * search submit, pagination, empty state, and the API receiving the right
 * querystring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import BrowsePage from '../src/pages/BrowsePage.jsx';

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
      return jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 });
    })
  );
}

function renderBrowse({ route = '/items' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <BrowsePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const ITEM = (id, title) => ({
  _id: id,
  title,
  type: 'Jacket',
  size: 'M',
  condition: 'GOOD',
  pointValue: 20,
  status: 'APPROVED',
  images: [{ url: `https://x.test/${id}.jpg`, isPrimary: true }],
});

beforeEach(() => {
  stubFetch();
  vi.useFakeTimers({ shouldAdvanceTime: true }); // debounce is timer-driven
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrowsePage — fetch and render', () => {
  it('fetches /items on mount and renders the grid of ItemCards', async () => {
    responses = {
      '/items?': [
        jsonResponse(200, {
          items: [ITEM('i1', 'Denim Jacket'), ITEM('i2', 'Summer Dress')],
          total: 2,
          page: 1,
          totalPages: 1,
        }),
      ],
    };
    renderBrowse();

    expect(await screen.findByText('Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText('Summer Dress')).toBeInTheDocument();
    expect(screen.getByText('2 items found')).toBeInTheDocument();
    expect(fetchCalls[0]).toContain('/items?');
  });

  it('sends page/pageSize and passes the URL q through to the API', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse({ route: '/items?page=2&q=wool+coat' });

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    const url = fetchCalls[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=12');
    expect(url).toContain('q=wool');
    expect(url).toContain('coat');
  });
});

describe('BrowsePage — URL-driven filters (§5.4)', () => {
  it('renders chips as active from the URL and toggling adds/removes the param', async () => {
    // JACKETS active in the URL initially.
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    const { container } = renderBrowse({ route: '/items?category=JACKETS' });

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(fetchCalls[0]).toContain('category=JACKETS');

    // Clicking the active chip removes it (toggle-off).
    fireEvent.click(screen.getByRole('button', { name: 'JACKETS' }));
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(1));
    expect(fetchCalls[fetchCalls.length - 1]).not.toContain('category=');
    void container;
  });

  it('supports multi-select across groups (repeated params reach the API)', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'JACKETS' }));
    fireEvent.click(screen.getByRole('button', { name: 'COATS' }));
    fireEvent.click(screen.getByRole('button', { name: 'M', exact: true }));

    await waitFor(() => {
      const last = fetchCalls[fetchCalls.length - 1];
      expect(last).toContain('category=JACKETS');
      expect(last).toContain('category=COATS');
      expect(last).toContain('size=M');
    });
  });

  it('commits q to the URL and refetches after the debounce — NO submit button', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    const before = fetchCalls.length;

    // No submit button exists anymore — the input IS the search flow.
    expect(screen.queryByRole('button', { name: /^search$/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search items/i), { target: { value: 'denim' } });

    // NOT committed immediately: no refetch fires before the silence window.
    expect(fetchCalls.length).toBe(before);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(fetchCalls.length).toBe(before); // still holding...

    act(() => {
      vi.advanceTimersByTime(1); // 300ms total → q commits, refetch fires
    });
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(before));
    expect(fetchCalls[fetchCalls.length - 1]).toContain('q=denim');
    // A q commit resets to page 1 — visible here as the explicit default.
    expect(fetchCalls[fetchCalls.length - 1]).toContain('page=1');
  });

  it('debounces a typing burst: one fetch with the FINAL value, not per keystroke', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    const before = fetchCalls.length;

    const input = screen.getByLabelText(/search items/i);
    fireEvent.change(input, { target: { value: 'd' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(input, { target: { value: 'de' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(input, { target: { value: 'denim' } });
    act(() => {
      vi.advanceTimersByTime(300); // only the last keystroke's full window elapses
    });

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(before));
    expect(fetchCalls.length).toBe(before + 1); // exactly ONE search fetch
    expect(fetchCalls[fetchCalls.length - 1]).toContain('q=denim');
  });

  it('back/forward navigation syncs the visible input (q changed outside the input)', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse({ route: '/items?q=wool' });

    // Deep-link: input shows the URL q and no refetch is scheduled for it.
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(screen.getByLabelText(/search items/i)).toHaveValue('wool');
    const afterMount = fetchCalls.length;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(fetchCalls.length).toBe(afterMount); // q === qInput → no-op, no loop

    // Clear-all-filters rewrites the URL directly; the input must follow.
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/search items/i)).toHaveValue('');
    });
  });
});

describe('BrowsePage — pagination and empty state', () => {
  it('commits the location filter to the URL with the same debounce', async () => {
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse();

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    const before = fetchCalls.length;

    fireEvent.change(screen.getByLabelText(/filter by location/i), {
      target: { value: 'mumbai' },
    });

    // Not committed immediately — same silence window as q.
    expect(fetchCalls.length).toBe(before);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(fetchCalls.length).toBe(before);

    act(() => {
      vi.advanceTimersByTime(1); // 300ms total → location commits, refetch fires
    });
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(before));
    expect(fetchCalls[fetchCalls.length - 1]).toContain('location=mumbai');
    expect(fetchCalls[fetchCalls.length - 1]).toContain('page=1'); // filter change resets page
  });

  it('renders pagination and requests the next page on click', async () => {
    responses = {
      '/items?': [
        jsonResponse(200, {
          items: [ITEM('i1', 'Page 1 Item')],
          total: 30,
          page: 1,
          totalPages: 3,
        }),
      ],
    };
    renderBrowse();

    expect(await screen.findByText('Page 1 Item')).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(1));
    expect(fetchCalls[fetchCalls.length - 1]).toContain('page=2');
  });

  it('hides pagination for a single page', async () => {
    responses = {
      '/items?': [
        jsonResponse(200, { items: [ITEM('i1', 'Only Item')], total: 1, page: 1, totalPages: 1 }),
      ],
    };
    renderBrowse();

    expect(await screen.findByText('Only Item')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
  });

  it('shows the empty state with a clear-filters CTA when total is 0', async () => {
    // Start WITH filters so clearing them is an actual navigation.
    responses = { '/items?': [jsonResponse(200, { items: [], total: 0, page: 1, totalPages: 1 })] };
    renderBrowse({ route: '/items?category=JACKETS&q=nothing-matches' });

    expect(await screen.findByText(/no items match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    // Should refetch with NO filter params (location included).
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(1));
    expect(fetchCalls[fetchCalls.length - 1]).not.toMatch(/(category|size|condition|q|location)=/);
  });
});
