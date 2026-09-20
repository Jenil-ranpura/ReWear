/**
 * <SwapRequestRow> (§12 key reusable component) — Session 14 redesign:
 * one SELF-EXPLANATORY card of the incoming/outgoing swap lists. The user
 * should understand a request at a glance, without clicking through:
 *
 * - WHO: the counterparty (requester on incoming — "wants your X"; on
 *   outgoing the row is about "your request"), with avatar/initial.
 * - WHAT: item cards with thumbnail, title, and the size · condition · pts
 *   spec line — for BOTH sides of a direct swap, joined by ⇄.
 * - PLAIN LANGUAGE: one summary sentence per type+direction+status, e.g.
 *   "Ada wants your Denim Jacket" / "You offered Silk Scarf for Wool Coat"
 *   / "Ada wants to redeem your Denim Jacket for 45 pts" — so the type chip
 *   never has to be decoded.
 * - NEW highlight: a PENDING incoming row the owner hasn't seen yet (client-
 *   side per-user seen set, lib/seenRequests.js) renders with a brand ring
 *   + "NEW" badge — owners spot fresh requests first (Session 14). The page
 *   computes `isNew`; the row stays presentational.
 * - Actions unchanged: incoming PENDING → ACCEPT/REJECT (§5.7 owner),
 *   outgoing PENDING → CANCEL; CONFIRMED via parent ConfirmDialog (§13).
 *
 * Data contract: GET /swap-requests rows now carry requesterId populated
 * ({_id, name, avatarUrl}) and itemId/offeredItemId populated with title,
 * status, pointValue, size, condition, images.url (Session 14 API change).
 * Defensive fallbacks keep older/unpopulated rows rendering as plain links.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import StatusBadge from '../shared/StatusBadge.jsx';
import ReportSwapDialog from './ReportSwapDialog.jsx';
import { useAuth } from '../../state/AuthContext.jsx';
import { DIRECT_SWAP } from '@rewear/shared-schemas';

/** Small item card: thumbnail + title + spec line. Falls back to a link. */
function ItemCard({ item, tone }) {
  if (!item?._id) return null;
  const spec = [item.size, item.condition?.replace('_', ' ')].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/items/${item._id}`}
      data-testid="swap-item-card"
      className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white p-2 ring-1 ring-stone-200 transition hover:ring-brand-300"
    >
      {item.images?.[0]?.url ? (
        <img src={item.images[0].url} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
      ) : (
        <span className="h-11 w-11 shrink-0 rounded bg-stone-100" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span
          className={`block truncate text-sm font-semibold ${
            tone === 'muted' ? 'text-stone-600' : 'text-stone-900'
          }`}
        >
          {item.title}
        </span>
        <span className="block truncate text-xs text-stone-500">
          {[spec, item.pointValue != null ? `${item.pointValue} pts` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </Link>
  );
}

/** Avatar with initial — the requester's name is the identity anchor. */
function PersonBubble({ name, avatarUrl }) {
  return avatarUrl ? (
    <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700"
    >
      {(name ?? '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

export default function SwapRequestRow({ request, direction, onAction, isNew = false }) {
  const [reporting, setReporting] = useState(false);
  const { user } = useAuth(); // identity for the report dialog's perspective
  const isPending = request.status === 'PENDING';
  const isAccepted = request.status === 'ACCEPTED';
  const isIncoming = direction === 'incoming';
  const isDirect = request.type === DIRECT_SWAP;
  // Highlight ONLY unseen PENDING incoming rows (a seen/terminal row that
  // reappears must never shout for attention).
  const highlight = isNew && isIncoming && isPending;

  // Populate shape: requesterId is a user doc; fall back to the raw id.
  const requester = request.requesterId;
  const requesterName = typeof requester === 'object' && requester !== null ? requester.name : null;
  const target = request.itemId;
  const offered = request.offeredItemId;

  // §5.9 plain-language summary: the sentence carries the meaning; the chip
  // is now only a secondary label. Terminal states read as facts, not asks.
  const summary = isIncoming
    ? isDirect
      ? `${requesterName ?? 'Someone'} wants to swap their item for your “${target?.title ?? 'item'}”`
      : `${requesterName ?? 'Someone'} wants to redeem your “${target?.title ?? 'item'}” for ${target?.pointValue ?? '—'} pts`
    : isDirect
      ? `You offered “${offered?.title ?? 'your item'}” for “${target?.title ?? 'their item'}”`
      : `You asked to redeem “${target?.title ?? 'their item'}” for ${target?.pointValue ?? '—'} pts`;
  return (
    <li
      className={`rounded-xl p-4 shadow-sm ring-1 ${
        highlight ? 'bg-brand-50 ring-2 ring-brand-400' : 'bg-stone-50 ring-1 ring-stone-200'
      }`}
      data-testid="swap-request-row"
      data-highlighted={highlight || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2.5">
          {/* Line 1 — counterparty + status + date. */}
          <div className="flex flex-wrap items-center gap-2">
            <PersonBubble
              name={requesterName}
              avatarUrl={typeof requester === 'object' ? requester?.avatarUrl : null}
            />
            <span className="text-sm font-semibold text-stone-800">
              {isIncoming ? (requesterName ?? 'A user') : 'You'}
            </span>
            {highlight && (
              <span
                data-testid="swap-new-badge"
                className="rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              >
                New
              </span>
            )}
            <StatusBadge status={request.status} />
            {request.createdAt && (
              <span className="text-xs text-stone-450">
                {new Date(request.createdAt).toLocaleDateString()}
              </span>
            )}
            <span className="rounded-full bg-stone-200/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
              {isDirect ? 'Direct swap' : 'Points redemption'}
            </span>
          </div>

          {/* Line 2 — the plain-language sentence (§5.9). */}
          <p className="text-sm text-stone-700" data-testid="swap-summary">
            {summary}
          </p>

          {/* Line 3 — the two item cards (visual anchor: photos + specs). */}
          <div className="flex flex-wrap items-center gap-2">
            <ItemCard item={target} />
            {isDirect && (
              <>
                <span aria-hidden="true" className="text-lg text-stone-450">
                  ⇄
                </span>
                <ItemCard item={offered} tone="muted" />
              </>
            )}
          </div>

          {/* Contact reveal (accepted rows only — the API attaches `contact`
              exclusively on ACCEPTED): how the two people actually meet up.
              Phone is tel:-linked and may be absent (volunteered/profile). */}
          {request.contact && (
            <div
              data-testid="swap-contact-card"
              className="rounded-lg bg-white p-3 ring-1 ring-brand-200"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
                Swap accepted — reach {request.contact.name ?? 'them'}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a
                  href={`mailto:${request.contact.email}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {request.contact.email}
                </a>
                {request.contact.phone && (
                  <a
                    href={`tel:${request.contact.phone}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {request.contact.phone}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex shrink-0 gap-2">
            {isIncoming ? (
              <>
                <button
                  type="button"
                  onClick={() => onAction?.(request, 'ACCEPT')}
                  className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => onAction?.(request, 'REJECT')}
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onAction?.(request, 'CANCEL')}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Fraud kit: a completed swap can always be disputed — by EITHER
            party. Quiet placement: secondary action, never a nudge. */}
        {isAccepted && (
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-stone-500 ring-1 ring-stone-300 hover:bg-stone-100 hover:text-stone-700"
            >
              Report a problem
            </button>
          </div>
        )}
      </div>

      {reporting && (
        <ReportSwapDialog
          open
          onClose={() => setReporting(false)}
          swapRequest={request}
          viewerId={user?._id}
        />
      )}
    </li>
  );
}
