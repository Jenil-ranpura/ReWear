/**
 * P5-T3 — Item detail page (§5.5/§5.6). Photo-first layout (§13):
 * gallery + details + owner + StatusBadge + pointValue, and the swap CTAs
 * with §5.5/§5.6 branching:
 *
 * - Guest → "Log in to swap" link
 * - Owner → no swap CTA (editing/deleting is P5-T4 dashboard scope)
 * - Other authenticated user → Request Swap (direct, §5.5) / Redeem via
 *   Points (§5.6, shown when balance ≥ pointValue)
 * - Non-APPROVED items render a §5.9 "no longer available" state (the API
 *   404s these for non-owners; NOT_FOUND and missing items look identical —
 *   no existence leak, §15).
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import * as itemsApi from '../lib/api/items.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import SwapRequestDialog from '../components/swaps/SwapRequestDialog.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { DIRECT_SWAP, POINTS_REDEMPTION } from '@rewear/shared-schemas';

const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e7e5e4"/><text x="400" y="300" font-family="sans-serif" font-size="24" fill="#78716c" text-anchor="middle">No photo</text></svg>`
  );

/** §5.5/§5.6 CTA block — owns the auth branching so the page stays readable. */
function SwapActions({ item, viewer, status }) {
  const [dialogType, setDialogType] = useState(null);

  const isOwner = viewer && item.owner && String(item.owner._id) === String(viewer._id);

  if (isOwner) {
    return (
      <p className="rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
        This is your listing. Manage it from your{' '}
        <Link to="/dashboard" className="font-semibold text-brand-700 hover:underline">
          dashboard
        </Link>
        .
      </p>
    );
  }

  if (!viewer) {
    return (
      <p className="rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Log in
        </Link>{' '}
        to request this item.
      </p>
    );
  }

  // Not available for swapping unless APPROVED (PENDING/RESERVED/… states).
  if (status !== 'APPROVED') {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This item isn&apos;t available for swaps right now.
      </p>
    );
  }

  const canRedeem = (viewer.pointsBalance ?? 0) >= (item.pointValue ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setDialogType(DIRECT_SWAP)}
          className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Request swap
        </button>
        <button
          type="button"
          onClick={() => setDialogType(POINTS_REDEMPTION)}
          disabled={!canRedeem}
          title={
            canRedeem
              ? undefined
              : `You need ${item.pointValue - (viewer.pointsBalance ?? 0)} more points to redeem this item.`
          }
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Redeem for {item.pointValue} pts
        </button>
        {dialogType && (
          <SwapRequestDialog
            open
            onClose={() => setDialogType(null)}
            onCreated={() => setDialogType(null)}
            item={item}
            type={dialogType}
            viewer={viewer}
          />
        )}
      </div>
      {!canRedeem && (
        <p className="text-sm text-stone-500">
          Earn points by listing items — you&apos;re{' '}
          {(item.pointValue ?? 0) - (viewer.pointsBalance ?? 0)} points away from this redemption.
        </p>
      )}
    </div>
  );
}

function Gallery({ images, title }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  return (
    <div className="space-y-3">
      <div className="aspect-[4/3] overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-1 ring-stone-200">
        <img
          src={active?.url ?? FALLBACK_IMAGE}
          alt={title}
          className="h-full w-full object-cover"
        />
      </div>
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <button
              key={img.url ?? i}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`Show photo ${i + 1} of ${images.length}`}
              aria-current={i === activeIndex}
              className={`h-16 w-16 overflow-hidden rounded-lg ring-2 transition ${
                i === activeIndex ? 'ring-brand-600' : 'ring-transparent hover:ring-stone-300'
              }`}
            >
              <img src={img.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Spec({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-stone-450">{label}</dt>
      <dd className="mt-0.5 font-medium text-stone-900">{value ?? '—'}</dd>
    </div>
  );
}

export default function ItemDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const itemQuery = useQuery({
    queryKey: ['item', id],
    queryFn: () => itemsApi.getOne(id),
  });

  const images = useMemo(() => itemQuery.data?.item?.images ?? [], [itemQuery.data]);

  return (
    <div className="space-y-6">
      <AsyncBoundary
        query={itemQuery}
        loadingNode={
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="aspect-[4/3] animate-pulse rounded-xl bg-stone-200" />
            <div className="space-y-3">
              <div className="h-8 w-3/4 animate-pulse rounded bg-stone-200" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-stone-100" />
              <div className="h-24 animate-pulse rounded bg-stone-200" />
            </div>
          </div>
        }
      >
        {(data) => {
          const { item } = data;
          return (
            <>
              {item.status !== 'APPROVED' && (
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  This listing is not publicly visible ({item.status}). You can see it because you
                  own it or you are an admin.
                  {item.moderationReason ? ` Reason: ${item.moderationReason}` : ''}
                </p>
              )}
              <div className="grid gap-8 lg:grid-cols-2">
                <Gallery images={images} title={item.title} />
                <div className="space-y-5">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="text-3xl font-bold text-stone-900">{item.title}</h1>
                      <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-sm font-bold text-brand-700">
                        {item.pointValue} pts
                      </span>
                    </div>
                    <StatusBadge status={item.status} className="mt-2" />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Spec label="Category" value={item.category} />
                    <Spec label="Type" value={item.type} />
                    <Spec label="Size" value={item.size} />
                    <Spec
                      label="Condition"
                      value={item.condition?.replace('_', ' ').toLowerCase()}
                    />
                  </dl>

                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-stone-450">
                      Description
                    </h2>
                    <p className="mt-1 whitespace-pre-line text-stone-700">{item.description}</p>
                  </div>

                  {item.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.owner && (
                    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
                      <h2 className="text-sm font-bold uppercase tracking-wide text-stone-450">
                        Listed by
                      </h2>
                      <p className="mt-1 font-semibold text-stone-900">{item.owner.name}</p>
                      {item.owner.location && (
                        <p className="text-sm text-stone-500">{item.owner.location}</p>
                      )}
                    </div>
                  )}

                  <SwapActions item={item} viewer={user} status={item.status} />
                </div>
              </div>
            </>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
