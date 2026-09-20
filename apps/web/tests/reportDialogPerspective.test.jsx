/**
 * <ReportSwapDialog> perspective tests (user request: "report a problem"
 * means different things to the two sides of a swap). The dialog is framed
 * from the VIEWER's seat:
 *  - redemption OWNER received points, not an item → item-condition reasons
 *    are hidden (no-show/other only);
 *  - redemption REQUESTER paid points and received the item → all reasons;
 *  - direct swap: all reasons both sides, but the condition reasons name the
 *    item THIS viewer received;
 *  - unknown viewer falls back to the requester (superset) view.
 * The reason VALUES submitted are the shared enum — unchanged server contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import ToastProvider from '../src/components/shared/ToastProvider.jsx';

const reportMock = vi.fn().mockResolvedValue({});

vi.mock('../src/lib/api/swaps.js', () => ({
  report: (...args) => reportMock(...args),
}));

const { default: ReportSwapDialog } = await import('../src/components/swaps/ReportSwapDialog.jsx');

afterEach(cleanup);
beforeEach(() => {
  reportMock.mockClear();
});

const OWNER = { _id: 'u-owner', name: 'Olive Owner' };
const REQUESTER = { _id: 'u-requester', name: 'Riley Requester' };

const REDEMPTION_SWAP = {
  _id: 's1',
  type: 'POINTS_REDEMPTION',
  status: 'ACCEPTED',
  requesterId: REQUESTER,
  itemId: { _id: 'i1', title: 'Denim Jacket', pointValue: 45 },
  offeredItemId: null,
};

const DIRECT_SWAP_ROW = {
  _id: 's2',
  type: 'DIRECT_SWAP',
  status: 'ACCEPTED',
  requesterId: REQUESTER,
  itemId: { _id: 'i1', title: 'Wool Coat', pointValue: 60 },
  offeredItemId: { _id: 'i2', title: 'Silk Scarf', pointValue: 30 },
};

function renderDialog(swap, viewerId) {
  return render(
    <ToastProvider>
      <ReportSwapDialog open onClose={vi.fn()} swapRequest={swap} viewerId={viewerId} />
    </ToastProvider>
  );
}

const dialog = () => screen.getByRole('dialog');

describe('<ReportSwapDialog> perspective framing', () => {
  it('redemption OWNER: hides item-condition reasons, frames "they redeemed your item"', () => {
    renderDialog(REDEMPTION_SWAP, OWNER._id);

    expect(within(dialog()).getByText('Problem with this redemption?')).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/redeemed your “Denim Jacket” for 45 pts/)
    ).toBeInTheDocument();

    // Their side of a redemption: received POINTS, gave the item.
    expect(within(dialog()).getByText('They never showed up / unreachable')).toBeInTheDocument();
    expect(within(dialog()).getByText('Something else')).toBeInTheDocument();
    // The point of the feature: these make no sense for someone who received no item.
    expect(within(dialog()).queryByText('Item was not as described')).not.toBeInTheDocument();
    expect(within(dialog()).queryByText('Item was fake or not delivered')).not.toBeInTheDocument();
  });

  it('redemption REQUESTER: all reasons (they received the item they paid for)', () => {
    renderDialog(REDEMPTION_SWAP, REQUESTER._id);

    expect(within(dialog()).getByText('Problem with your redemption?')).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/You redeemed “Denim Jacket” for 45 pts/)
    ).toBeInTheDocument();
    expect(within(dialog()).getByText('Item was not as described')).toBeInTheDocument();
    expect(within(dialog()).getByText('Item was fake or not delivered')).toBeInTheDocument();
  });

  it('direct swap OWNER: all reasons, and condition reasons name the item THEY received', () => {
    renderDialog(DIRECT_SWAP_ROW, OWNER._id);

    expect(
      within(dialog()).getByText(/You gave “Wool Coat” and received “Silk Scarf”/)
    ).toBeInTheDocument();
    // The hint under the condition reasons disambiguates WHICH item.
    expect(within(dialog()).getAllByText('You received: “Silk Scarf”')).toHaveLength(2);
    expect(within(dialog()).getByText('Item was not as described')).toBeInTheDocument();
  });

  it('direct swap REQUESTER: condition reasons name the item THEY received', () => {
    renderDialog(DIRECT_SWAP_ROW, REQUESTER._id);

    expect(
      within(dialog()).getByText(/You offered “Silk Scarf” and received “Wool Coat”/)
    ).toBeInTheDocument();
    expect(within(dialog()).getAllByText('You received: “Wool Coat”')).toHaveLength(2);
  });

  it('unknown viewer falls back to the requester (superset) view', () => {
    renderDialog(REDEMPTION_SWAP, undefined);

    expect(within(dialog()).getByText('Problem with your redemption?')).toBeInTheDocument();
    expect(within(dialog()).getByText('Item was not as described')).toBeInTheDocument();
  });

  it('files the shared enum value the admin queue expects (unchanged contract)', async () => {
    renderDialog(REDEMPTION_SWAP, REQUESTER._id);

    fireEvent.click(within(dialog()).getByRole('radio', { name: /not as described/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /file report/i }));

    await waitFor(() => {
      expect(reportMock).toHaveBeenCalledWith('s1', { reason: 'ITEM_NOT_AS_DESCRIBED' });
    });
  });
});
