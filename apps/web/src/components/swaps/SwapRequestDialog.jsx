/**
 * <SwapRequestDialog> (§13: "swap-request actions use a confirm dialog").
 * Built ON <ConfirmDialog> (reuses its focus/Escape/backdrop/aria wiring —
 * no second dialog pattern). The body switches on the request type (§5.5/§5.6):
 *
 * - POINTS_REDEMPTION: a plain confirmation showing the cost vs the caller's
 *   balance.
 * - DIRECT_SWAP: a picker over the caller's own APPROVED, un-reserved items
 *   (the §14.2 creation rules), loaded via usersApi.listMyItems(). Disabled
 *   confirm until a valid offer is selected; radio inputs are native and
 *   keyboard-accessible.
 *
 * Error surface: the dialog stays open and renders the server's §10 message
 * inline (DUPLICATE_REQUEST / INSUFFICIENT_POINTS / …), so the user can
 * cancel or retry — §5.9 recovery states.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as swapsApi from '../../lib/api/swaps.js';
import * as usersApi from '../../lib/api/users.js';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { useToast } from '../shared/ToastProvider.jsx';
import { DIRECT_SWAP, isValidRealPhone, PHONE_ERROR } from '@rewear/shared-schemas';

export default function SwapRequestDialog({ open, onClose, onCreated, item, type, viewer }) {
  const [offeredItemId, setOfferedItemId] = useState(null);
  const [requesterPhone, setRequesterPhone] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const isDirect = type === DIRECT_SWAP;

  // Only fetched while the dialog is open, and only for direct swaps.
  const myItemsQuery = useQuery({
    queryKey: ['my-items'],
    queryFn: usersApi.listMyItems,
    enabled: open && isDirect,
  });

  // §14.2: the offer must be APPROVED and owned by the caller — the picker
  // filters the server response client-side.
  const offerableItems = (myItemsQuery.data?.items ?? []).filter(
    (i) => i.status === 'APPROVED' && i._id !== item?._id
  );

  async function submit() {
    // Client-side gate mirrors the shared schema (server re-validates): a
    // volunteered number must be a REAL number, or the request never fires.
    const phone = requesterPhone.trim();
    if (phone && !isValidRealPhone(phone)) {
      setError(PHONE_ERROR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = isDirect
        ? { type, offeredItemId, requesterPhone: phone || undefined }
        : { type, requesterPhone: phone || undefined };
      const created = await swapsApi.createOnItem(item._id, payload);
      // §5.5/§5.6 UI result: "Pending" state — confirmed in plain language.
      push(
        isDirect
          ? 'Swap request sent — the owner will review it.'
          : 'Redemption request sent — awaiting the owner\u2019s approval.',
        { tone: 'success' }
      );
      onCreated?.(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={isDirect ? 'Request a direct swap' : 'Redeem via points'}
      confirmLabel={isDirect ? 'Send swap request' : 'Send redemption request'}
      busy={busy}
      confirmDisabled={isDirect && !offeredItemId}
      onConfirm={submit}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="mb-3 rounded-[6px] bg-red-50 px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      {isDirect ? (
        <div>
          <p className="text-sm text-ink-2">Pick one of your items to offer for “{item?.title}”.</p>
          {myItemsQuery.isLoading ? (
            <p className="mt-3 text-sm text-stone-450">Loading your items…</p>
          ) : offerableItems.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">
              You have no approved items to offer. Items must be approved by a moderator before they
              can be swapped.
            </p>
          ) : (
            <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
              {offerableItems.map((offer) => (
                <li key={offer._id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-[6px] p-2 ring-1 ring-hairline transition-colors hover:bg-brand-50/60">
                    <input
                      type="radio"
                      name="offered-item"
                      value={offer._id}
                      checked={offeredItemId === offer._id}
                      onChange={() => setOfferedItemId(offer._id)}
                      className="accent-brand-600"
                    />
                    {offer.images?.[0]?.url ? (
                      <img
                        src={offer.images[0].url}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <span className="h-10 w-10 rounded bg-canvas" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {offer.title}
                      </span>
                      <span className="tabular block text-xs text-ink-2">
                        {[offer.size, offer.condition].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {offer.pointValue != null && (
                      <span className="tabular shrink-0 text-xs font-bold text-brand-700">
                        {offer.pointValue} pts
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-2">
          This will request “{item?.title}” for{' '}
          <strong className="text-brand-700">{item?.pointValue} points</strong>. You currently have{' '}
          <strong>{viewer?.pointsBalance ?? 0}</strong>.
        </p>
      )}

      {/* Contact reveal: the requester may volunteer a number for THIS
          exchange — the owner sees it only if they accept (§ swapService).
          Shared across both request types; same validation rules as the API. */}
      <div className="mt-3">
        <label htmlFor="requester-phone" className="block text-sm font-semibold text-ink">
          Your phone <span className="font-normal text-stone-450">(optional)</span>
        </label>
        <input
          id="requester-phone"
          type="tel"
          value={requesterPhone}
          onChange={(e) => setRequesterPhone(e.target.value)}
          placeholder="+91 98765 43210"
          autoComplete="tel"
          className="field mt-1"
        />
        <p className="mt-1 text-xs text-stone-450">
          Include country code. Shared with them only if they accept.
        </p>
      </div>
    </ConfirmDialog>
  );
}
