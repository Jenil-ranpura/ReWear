/**
 * <ReportSwapDialog> — user-requested fraud-response kit. Lets either party
 * of an ACCEPTED swap file a dispute. Built ON <ConfirmDialog> (one dialog
 * pattern; Escape/focus/aria wiring inherited). The reason list is the SHARED
 * enum (§8) rendered as native radios; details is bounded free text. The
 * dialog stays open on server errors (§5.9 recovery) and toasts on success.
 *
 * PERSPECTIVE-AWARE (user request): "report a problem" means different things
 * to the two sides of a swap, so the dialog is framed from the VIEWER's seat:
 *  - POINTS_REDEMPTION owner: they GAVE an item and RECEIVED points — they
 *    never received an item, so "not as described"/"fake item" are hidden;
 *    only no-show/other are offered.
 *  - POINTS_REDEMPTION requester: they PAID points and RECEIVED the item —
 *    every reason applies.
 *  - DIRECT_SWAP: both sides received an item, so every reason applies to
 *    both — but "not as described" refers to DIFFERENT items per side, so
 *    the radios say WHICH item the viewer received.
 * The reason ENUM and the server contract are unchanged — the admin queue
 * still sees the same four values; this only guides the filing UI.
 */

import { useState } from 'react';

import * as swapsApi from '../../lib/api/swaps.js';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { useToast } from '../shared/ToastProvider.jsx';
import { REPORT_REASON, POINTS_REDEMPTION } from '@rewear/shared-schemas';

const REASON_LABELS = {
  NO_SHOW: 'They never showed up / unreachable',
  ITEM_NOT_AS_DESCRIBED: 'Item was not as described',
  FAKE_ITEM: 'Item was fake or not delivered',
  OTHER: 'Something else',
};

/**
 * Build the viewer's reason list + framing from the swap document.
 * Populated rows carry requesterId (user doc), itemId and offeredItemId
 * (item docs); defensive fallbacks keep unpopulated rows renderable.
 */
function buildPerspective(swapRequest, viewerId) {
  const requesterId = swapRequest?.requesterId?._id ?? swapRequest?.requesterId;
  // Unknown viewer (no id passed) defaults to the requester view — the
  // superset of reasons — so the dialog never renders an empty list.
  const isRequester = viewerId == null || String(requesterId) === String(viewerId);
  const isRedemption = swapRequest?.type === POINTS_REDEMPTION;

  const requesterName =
    typeof swapRequest?.requesterId === 'object' && swapRequest?.requesterId !== null
      ? swapRequest.requesterId.name
      : null;
  const target = swapRequest?.itemId; // the owner's item (what was requested)
  const offered = swapRequest?.offeredItemId; // the requester's item (direct swaps)

  // What THIS viewer received from the exchange — the referent for
  // "not as described" / "fake item".
  const receivedItem = isRequester ? target : offered;

  // Reasons this viewer can meaningfully file. The owner of a redemption
  // received POINTS, not an item — item-condition reasons don't apply.
  const reasons = isRedemption && !isRequester ? ['NO_SHOW', 'OTHER'] : [...REPORT_REASON];

  const title = isRedemption
    ? isRequester
      ? 'Problem with your redemption?'
      : 'Problem with this redemption?'
    : 'Report this swap?';

  let intro;
  if (isRedemption) {
    intro = isRequester
      ? `You redeemed “${target?.title ?? 'the item'}” for ${target?.pointValue ?? '—'} pts.`
      : `${requesterName ?? 'They'} redeemed your “${target?.title ?? 'item'}” for ${target?.pointValue ?? '—'} pts.`;
  } else if (isRequester) {
    intro = `You offered “${offered?.title ?? 'your item'}” and received “${target?.title ?? 'their item'}”.`;
  } else {
    intro = `You gave “${target?.title ?? 'your item'}” and received “${offered?.title ?? 'their item'}”.`;
  }

  // Condition reasons name the item the viewer actually received, so the
  // admin's later read of the report is unambiguous too.
  const receivedHint = receivedItem?.title != null ? `You received: “${receivedItem.title}”` : null;

  return {
    title,
    intro,
    reasons: reasons.map((value) => ({
      value,
      label: REASON_LABELS[value],
      hint:
        (value === 'ITEM_NOT_AS_DESCRIBED' || value === 'FAKE_ITEM') && receivedHint
          ? receivedHint
          : null,
    })),
  };
}

export default function ReportSwapDialog({ open, onClose, swapRequest, viewerId }) {
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const { title, intro, reasons } = buildPerspective(swapRequest, viewerId);

  async function submit() {
    if (!reason) {
      setError('Pick the reason that fits best.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await swapsApi.report(swapRequest._id, {
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      onClose();
      push('Report filed. An admin will review it and follow up.', { tone: 'success' });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      title={title}
      confirmLabel="File report"
      confirmDisabled={!reason}
      onConfirm={submit}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="text-sm text-stone-600">{intro}</p>
      <p className="mt-1 text-sm text-stone-600">
        Tell us what went wrong. An admin will review both sides and the points history — decisions
        are never automated.
      </p>

      <fieldset className="mt-3 space-y-1.5">
        <legend className="sr-only">Reason</legend>
        {reasons.map(({ value, label, hint }) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-stone-200 p-2 text-sm hover:bg-stone-50"
          >
            <input
              type="radio"
              name="report-reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
              className="accent-brand-600"
            />
            <span>
              {label}
              {hint && <span className="block text-xs text-stone-450">{hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-3">
        <label htmlFor="report-details" className="block text-sm font-medium text-stone-700">
          Details <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <textarea
          id="report-details"
          rows={3}
          maxLength={500}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What happened? Numbers, times, anything that helps."
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
      </div>
    </ConfirmDialog>
  );
}
