/**
 * P5-T7 — shared component tests. Render-level coverage of the §12 reusable
 * components: StatusBadge mapping, ItemCard content/links, AsyncBoundary's
 * §5.9 states (loading/error/empty/data), and ConfirmDialog interactions.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import StatusBadge from '../src/components/shared/StatusBadge.jsx';
import ItemCard from '../src/components/shared/ItemCard.jsx';
import AsyncBoundary from '../src/components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../src/components/shared/ConfirmDialog.jsx';

function renderWithProviders(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const noop = () => {};

afterEach(cleanup);

const ITEM = {
  _id: 'item1',
  title: 'Corduroy Jacket',
  type: 'Jacket',
  size: 'M',
  condition: 'GOOD',
  pointValue: 35,
  status: 'PENDING',
  images: [{ url: 'https://x.test/jacket.jpg', isPrimary: true }],
};

describe('<StatusBadge>', () => {
  it('renders a human label for multi-word statuses', () => {
    renderWithProviders(<StatusBadge status="PENDING_TRANSFER" />);
    expect(screen.getByText('Pending transfer')).toBeInTheDocument();
  });

  it('renders unknown statuses in neutral styling without crashing', () => {
    renderWithProviders(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument();
  });
});

describe('<ItemCard>', () => {
  it('links to the item detail page and shows title/points/meta', () => {
    renderWithProviders(<ItemCard item={ITEM} />);
    const link = screen.getByRole('link', { name: /corduroy jacket/i });
    expect(link).toHaveAttribute('href', '/items/item1');
    expect(screen.getByText('35 pts')).toBeInTheDocument();
    expect(screen.getByText(/jacket · m · good/i)).toBeInTheDocument();
  });

  it('hides the status badge for approved items', () => {
    renderWithProviders(<ItemCard item={{ ...ITEM, status: 'APPROVED' }} />);
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument();
  });

  it('falls back to a typographic placeholder when there are no images', () => {
    // Redesign: the data-URI "No photo" SVG became a refined tonal block
    // with the title initial — still a named, accessible graphic.
    renderWithProviders(<ItemCard item={{ ...ITEM, images: [] }} />);
    const img = screen.getByRole('img', { name: /corduroy jacket/i });
    expect(img).not.toHaveAttribute('src');
    expect(img.textContent).toContain('C');
  });
});

describe('<AsyncBoundary>', () => {
  it('shows the loading skeleton while pending', () => {
    renderWithProviders(<AsyncBoundary query={{ isLoading: true }}>{noop}</AsyncBoundary>);
    expect(screen.getByTestId('async-loading')).toBeInTheDocument();
  });

  it('renders loadingNode instead of the card-grid skeleton when provided', () => {
    renderWithProviders(
      <AsyncBoundary query={{ isLoading: true }} loadingNode={<div>detail skeleton</div>}>
        {noop}
      </AsyncBoundary>
    );
    expect(screen.getByTestId('async-loading')).toHaveTextContent('detail skeleton');
  });

  it('shows the error state with retry and never a stack trace', async () => {
    const refetch = vi.fn();
    renderWithProviders(
      <AsyncBoundary query={{ error: { message: 'Cannot reach the server.' }, refetch }}>
        {noop}
      </AsyncBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Cannot reach the server.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders children(data) when populated and the empty node when the array is empty', () => {
    const { unmount } = renderWithProviders(
      <AsyncBoundary query={{ data: [] }} empty={<div>No items yet</div>}>
        {() => <div>cards</div>}
      </AsyncBoundary>
    );
    expect(screen.getByText('No items yet')).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <AsyncBoundary query={{ data: [1, 2] }} empty={<div>No items yet</div>}>
        {() => <div>cards</div>}
      </AsyncBoundary>
    );
    expect(screen.getByText('cards')).toBeInTheDocument();
    expect(screen.queryByText('No items yet')).not.toBeInTheDocument();
  });

  it('supports a custom isEmpty for object envelopes like { items, total }', () => {
    renderWithProviders(
      <AsyncBoundary
        query={{ data: { items: [], total: 0 } }}
        isEmpty={(d) => d.total === 0}
        empty={<div>empty queue</div>}
      >
        {() => <div>rows</div>}
      </AsyncBoundary>
    );
    expect(screen.getByText('empty queue')).toBeInTheDocument();
  });
});

describe('<ConfirmDialog>', () => {
  it('renders nothing when closed', () => {
    renderWithProviders(<ConfirmDialog open={false} onConfirm={noop} onClose={noop} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms and cancels; Escape closes', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open
        title="Accept swap?"
        message="This cannot be undone."
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Accept swap?')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('focuses the confirm button on open', () => {
    renderWithProviders(
      <ConfirmDialog open confirmLabel="Accept" onConfirm={noop} onClose={noop} />
    );
    expect(screen.getByRole('button', { name: /accept/i })).toHaveFocus();
  });

  // Regression: AdminUsersPage ban dialog. The parent passed an inline arrow
  // onClose (new identity every render) and rendered a reason <textarea> as
  // the dialog child. The old initial-focus effect depended on [open,
  // onClose], so the FIRST character typed re-rendered the parent, re-ran
  // the effect, and yanked focus from the textarea to the confirm button —
  // making the reason field impossible to type more than one char into.
  it('keeps focus in an input while typing, even when onClose changes identity every render', () => {
    function BanDialog() {
      const [reason, setReason] = useState('');
      return (
        <ConfirmDialog
          open
          title="Ban user"
          confirmLabel="Ban"
          onConfirm={noop}
          onClose={() => {}} // new identity on every render, like the real caller
        >
          <textarea
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </ConfirmDialog>
      );
    }
    renderWithProviders(<BanDialog />);

    const textarea = screen.getByLabelText(/reason/i);
    textarea.focus(); // user clicks into the field
    fireEvent.input(textarea, { target: { value: 'r' } });

    // The state update re-rendered the parent (fresh onClose) — focus must
    // STAY on the textarea, not jump back to the confirm button.
    expect(textarea).toHaveFocus();
    expect(screen.getByRole('button', { name: /ban/i })).not.toHaveFocus();
  });

  it('shows a busy state while the action is in flight', () => {
    renderWithProviders(
      <ConfirmDialog open busy confirmLabel="Accept" onConfirm={noop} onClose={noop} />
    );
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
  });

  // P7-T5 — dialog focus semantics.
  it('traps Tab: focus cycles inside the dialog instead of escaping to the page', () => {
    renderWithProviders(
      <ConfirmDialog open title="T" message="M" onConfirm={noop} onClose={noop} />
    );
    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: /cancel/i });
    const confirm = within(dialog).getByRole('button', { name: /confirm/i });

    // Confirm (autofocused, LAST focusable) + Tab → wraps to the FIRST one.
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    // Cancel (first) + Shift+Tab → wraps back to the LAST one.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('restores focus to the opener when it closes', () => {
    function Trigger() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ConfirmDialog open={open} onConfirm={noop} onClose={() => setOpen(false)} />
        </>
      );
    }
    renderWithProviders(<Trigger />);
    const opener = screen.getByRole('button', { name: /open/i });
    opener.focus();

    // Open → focus moves into the dialog; close (Escape) → back to the opener.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('exposes the busy state and description through aria (screen-reader contract)', () => {
    renderWithProviders(
      <ConfirmDialog open title="T" message="M" busy onConfirm={noop} onClose={noop} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-description');
    // The describedby target must actually exist inside the dialog.
    expect(dialog.querySelector('#confirm-dialog-description')).not.toBeNull();
  });
});
