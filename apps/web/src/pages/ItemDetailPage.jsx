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
 *
 * Redesign: editorial gallery (4:5, quiet thumbnails), sticky right-hand
 * panel with display-serif title, tabular points, hairline spec table, and
 * a visually quiet admin control. Queries/dialogs/role branches unchanged.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import * as itemsApi from '../lib/api/items.js';
import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import SwapRequestDialog from '../components/swaps/SwapRequestDialog.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { DIRECT_SWAP, POINTS_REDEMPTION, moderateItemSchema } from '@rewear/shared-schemas';

/** §5.5/§5.6 CTA block — owns the auth branching so the page stays readable. */
function SwapActions({ item, viewer, status }) {
  const [dialogType, setDialogType] = useState(null);

  const isOwner = viewer && item.owner && String(item.owner._id) === String(viewer._id);

  if (isOwner) {
    return (
      <p className="rounded-[6px] bg-tint px-4 py-3 text-sm text-brand-800">
        This is your listing. Manage it from your{' '}
        <Link to="/dashboard" className="font-semibold underline underline-offset-2">
          dashboard
        </Link>
        .
      </p>
    );
  }

  if (!viewer) {
    return (
      <p className="rounded-[6px] bg-tint px-4 py-3 text-sm text-brand-800">
        <Link to="/login" className="font-semibold underline underline-offset-2">
          Log in
        </Link>{' '}
        to request this item.
      </p>
    );
  }

  // Not available for swapping unless APPROVED (PENDING/RESERVED/… states).
  if (status !== 'APPROVED') {
    return (
      <p className="rounded-[6px] bg-amber-50 px-4 py-3 text-sm text-status-amber">
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
          className="pressable rounded-[6px] bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
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
          className="pressable rounded-[6px] bg-white px-5 py-2.5 text-sm font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Redeem for <span className="tabular">{item.pointValue}</span> pts
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
        <p className="tabular text-sm text-ink-2">
          Earn points by listing items — you&apos;re{' '}
          {(item.pointValue ?? 0) - (viewer.pointsBalance ?? 0)} points away from this redemption.
        </p>
      )}
    </div>
  );
}

/**
 * Admin takedown control (problem statement: "remove inappropriate or spam
 * items") — shown to ADMINS on live (APPROVED) listings so a listing can be
 * struck the moment it's reported, from where the admin is already looking
 * at it. The reason is resolved against the SHARED moderateItemSchema
 * (REMOVE requires one); errors keep the dialog open (§5.9). Visually
 * quiet: hairline card, one restrained destructive affordance.
 */
function AdminRemoveControl({ item }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(moderateItemSchema),
    defaultValues: { action: 'REMOVE', reason: '' },
  });

  const onConfirm = async ({ reason }) => {
    setServerError(null);
    try {
      await adminApi.moderate(item._id, 'REMOVE', reason);
      setOpen(false);
      push(`“${item.title}” removed — no longer publicly visible.`, { tone: 'success' });
      queryClient.removeQueries({ queryKey: ['item', String(item._id)] });
      // The admin's destination for removed items is the takedown trail.
      navigate('/admin/live');
    } catch (err) {
      setServerError(err.message ?? 'Something went wrong. Please try again.');
    }
  };

  if (item.status !== 'APPROVED') return null;

  return (
    <div className="card p-4">
      <h2 className="eyebrow">Admin controls</h2>
      <p className="mt-1.5 text-sm text-ink-2">
        Remove this listing if it is inappropriate or spam. The owner sees the reason.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable mt-3 rounded-[6px] px-3.5 py-2 text-sm font-semibold text-status-red ring-1 ring-status-red/30 transition-colors hover:bg-red-50"
      >
        Remove listing
      </button>

      {open && (
        <ConfirmDialog
          open
          busy={isSubmitting}
          danger
          title={`Remove “${item.title}”?`}
          message="The listing disappears from Browse immediately and the owner sees the reason. This cannot be undone."
          confirmLabel="Remove"
          onClose={() => !isSubmitting && setOpen(false)}
          onConfirm={handleSubmit(onConfirm)}
        >
          <div className="space-y-1">
            <label htmlFor="admin-remove-reason" className="text-sm font-semibold text-ink">
              Reason for the owner <span className="font-normal text-status-red">(required)</span>
            </label>
            <textarea
              id="admin-remove-reason"
              rows={3}
              maxLength={500}
              aria-invalid={Boolean(errors.reason)}
              {...registerField('reason')}
              placeholder="e.g. Counterfeit brand listing"
              className="field"
            />
            {errors.reason && <p className="text-sm text-status-red">{errors.reason.message}</p>}
            {serverError && <p className="text-sm text-status-red">{serverError}</p>}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Gallery({ images, title }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  return (
    <div className="space-y-3">
      <div className="aspect-[4/5] overflow-hidden rounded-[12px] border border-hairline bg-tint">
        {active?.url ? (
          <img
            src={active.url}
            alt={title}
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            role="img"
            aria-label={title}
            className="flex h-full w-full items-center justify-center"
          >
            <span aria-hidden="true" className="font-display text-7xl text-brand-300">
              {(title ?? '?').trim().charAt(0).toUpperCase()}
            </span>
          </div>
        )}
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
              className={`h-16 w-16 overflow-hidden rounded-[6px] ring-2 transition-all duration-200 ${
                i === activeIndex ? 'ring-brand-700' : 'ring-transparent hover:ring-ink/20'
              }`}
            >
              <img
                src={img.url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Spec({ label, value }) {
  return (
    <div className="border-t border-hairline py-2.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{value ?? '—'}</dd>
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
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="aspect-[4/5] animate-pulse rounded-[12px] bg-ink/6" />
            <div className="space-y-3">
              <div className="h-10 w-3/4 animate-pulse rounded bg-ink/6" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-ink/4" />
              <div className="h-24 animate-pulse rounded bg-ink/6" />
            </div>
          </div>
        }
      >
        {(data) => {
          const { item } = data;
          return (
            <>
              {item.status !== 'APPROVED' && (
                <p className="rounded-[6px] bg-amber-50 px-4 py-3 text-sm text-status-amber">
                  This listing is not publicly visible ({item.status}). You can see it because you
                  own it or you are an admin.
                  {item.moderationReason ? ` Reason: ${item.moderationReason}` : ''}
                </p>
              )}
              <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
                <Gallery images={images} title={item.title} />

                {/* Sticky panel: details stay in view beside the tall gallery. */}
                <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">
                        {item.title}
                      </h1>
                      <span className="tabular shrink-0 rounded-full bg-tint px-3 py-1 text-sm font-semibold text-brand-800">
                        {item.pointValue} pts
                      </span>
                    </div>
                    <div className="mt-2">
                      <StatusBadge status={item.status} />
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6">
                    <Spec label="Category" value={item.category} />
                    <Spec label="Type" value={item.type} />
                    <Spec label="Size" value={item.size} />
                    <Spec
                      label="Condition"
                      value={item.condition?.replace('_', ' ').toLowerCase()}
                    />
                  </dl>

                  <div>
                    <h2 className="eyebrow">Description</h2>
                    <p className="measure mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">
                      {item.description}
                    </p>
                  </div>

                  {item.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-ink-2 ring-1 ring-hairline"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.owner && (
                    <div className="flex items-center gap-3 border-y border-hairline py-4">
                      {item.owner.avatarUrl ? (
                        <img
                          src={item.owner.avatarUrl}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover ring-1 ring-hairline"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-tint text-sm font-semibold text-brand-800"
                        >
                          {item.owner.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                      )}
                      <div>
                        <p className="eyebrow">Listed by</p>
                        <p className="text-sm font-semibold text-ink">{item.owner.name}</p>
                        {item.owner.location && (
                          <p className="text-sm text-ink-2">{item.owner.location}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <SwapActions item={item} viewer={user} status={item.status} />

                  {user?.role === 'ADMIN' && <AdminRemoveControl item={item} />}
                </div>
              </div>
            </>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
