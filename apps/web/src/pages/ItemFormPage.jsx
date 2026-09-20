/**
 * P5-T4 — Add/Edit item form (§5.3) with P6-T5 AI-assist wiring (§14.4).
 *
 * CREATE (/items/new) implements the §5.3 upload-first flow EXACTLY:
 *   pick files → POST /items/images (immediate, via <ImageUploader>) →
 *   [P6-T5] POST /items/classify on the first photo of each batch →
 *   attach the returned [{url, perceptualHash}] → POST /items →
 *   "Submitted for review" success panel (§5.3 UI result).
 *
 * P6-T5 AI-assist contract (§14.4/§16, advisory-only):
 * - Fires ONCE per upload batch (first image), scoped to the uploader —
 *   "the form stays interactive; the suggestion pops in when ready" (§23).
 * - suggestion null (no AI configured, low confidence, timeout — the API
 *   always 200s) → nothing happens; the form is simply fully manual.
 * - Pre-fills category/condition/pointValue with an "AI suggested" tag on
 *   category/condition (pointValue follows automatically from the formula);
 *   EVERY field remains fully editable (§13: never locked).
 * - pointValue is DERIVED, never chosen: category × condition recomputes it
 *   live (user request, §14.4 revised). The field is read-only in the UI AND
 *   the API re-derives server-side — a client cannot set it at all.
 * - suggestedPoints is FORMULA-derived server-side from the SAME frozen
 *   BASE_POINTS/CONDITION_MULTIPLIERS tables rendered under the field.
 * - A classify failure can NEVER block listing: it silently degrades.
 *
 * A failed upload never discards entered fields (§5.9) — the uploader only
 * replaces its own image list; server errors render in a role=alert banner.
 *
 * EDIT (/items/:id/edit): owner-only, loads via itemsApi.getOne, prefills
 * everything including the item's existing images (their server-computed
 * perceptualHashes are echoed back so the duplicate flag keeps working).
 * Guards: non-owners → 403 panel; non-PENDING/APPROVED or REMOVED/SWAPPED
 * items → §10 contract panel instead of a doomed form (the API would 409).
 *
 * Validation: the SHARED itemCreateSchema (§8 — byte-identical rules on both
 * sides). pointValue is NOT user-decided (§14.4 revised): it auto-computes
 * from category × condition and the field is read-only; the server derives
 * the authoritative value regardless of what the form sends. Tags are
 * comma-input, trimmed and de-duped before validation. Duplicate-image
 * response is an ADVISORY notice (§14.1: flag, never block).
 *
 * ASSUMPTION: delete lives on the edit page (§10 owner flow) rather than the
 * future dashboard → owners manage a listing where they see it; P5-T5 links here.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';

import {
  itemFieldsSchema,
  ITEM_CONDITION,
  ITEM_CATEGORIES,
  BASE_POINTS,
  CONDITION_MULTIPLIERS,
  computeSuggestedPoints,
} from '@rewear/shared-schemas';
import { ApiError } from '../lib/api/client.js';
import * as itemsApi from '../lib/api/items.js';
import ImageUploader from '../components/shared/ImageUploader.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';

const EMPTY_FORM = {
  title: '',
  description: '',
  category: '',
  type: '',
  size: '',
  condition: '',
  tags: '',
  pointValue: '',
};
/** Fields that must be present on an existing item to allow editing (§10). */
const EDITABLE_STATUSES = ['PENDING', 'APPROVED'];

function tagsToInput(tags) {
  return (tags ?? []).join(', ');
}

/** "denim, vintage , denim" → ['denim', 'vintage'] (trimmed, deduped). */
function parseTags(input) {
  const seen = new Set();
  for (const raw of String(input ?? '').split(',')) {
    const tag = raw.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

const inputClass =
  'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200';

/** Condition labels for the §14.4 multiplier table shown under Point value. */
const CONDITION_LABELS = {
  NEW: 'Like brand new',
  LIKE_NEW: 'Worn once or twice',
  GOOD: 'Light visible wear',
  FAIR: 'Noticeable wear',
  WORN: 'Heavy wear',
};

function Field({ id, label, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function ItemFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { push } = useToast();

  const [images, setImagesState] = useState([]);
  const [tagsInput, setTagsInput] = useState('');
  const [serverError, setServerError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [created, setCreated] = useState(null);
  const [existing, setExisting] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // P6-T5: which fields currently carry an AI suggestion (§12 "AI suggested"
  // indicator). A user edit clears the tag on that field — the suggestion is
  // a pre-fill, never a lock (§13). Cleared entirely on the next batch.
  const [aiFields, setAiFields] = useState({});
  const [aiState, setAiState] = useState('idle'); // idle | loading | ready | none

  const {
    register: registerField,
    handleSubmit,
    reset,
    setValue,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    // itemFieldsSchema = the SHARED schema minus images (§8): images live in
    // uploader state, not RHF values, so the resolver must not gate on them.
    // The image-count rule (≥1) is enforced pre-submit in onSubmit.
    resolver: yupResolver(itemFieldsSchema),
    mode: 'onBlur',
    defaultValues: { ...EMPTY_FORM, tags: [] },
  });

  // Live values for the point auto-calc (category × condition on each pick).
  const watchCategory = watch('category');
  const watchCondition = watch('condition');

  /**
   * Live point-value auto-calc (§14.4, user request): category × condition
   * from the FIXED table — the same math the server uses. Runs on every
   * category/condition change and overrides ANY current value (including the
   * AI's): the visible picks are the truth. The field stays editable — the
   * very next category/condition pick recalculates again.
   */
  function recalculatePoints(category, condition) {
    if (!category || !condition) return;
    const points = computeSuggestedPoints(category, condition);
    setValue('pointValue', points, { shouldDirty: true });
    clearErrors('pointValue');
    // The formula is the source of truth — no "AI suggested" tag on points:
    // AI's suggestedPoints is ALSO derived from this table (P6-T4), so both
    // flows land on the same number with the same (absent) tag.
    setAiFields((prev) => ({ ...prev, pointValue: false }));
  }

  /**
   * A stale image-related form error ("Add at least one photo…") must clear
   * the moment the uploader reports success OR failure — otherwise two alerts
   * show at once (§5.9: one clear message, not competing ones). The uploader
   * renders its own alert; the form yields the alert slot to it.
   */
  function clearImageSubmitError() {
    setServerError((prev) => (prev && prev.startsWith('Add at least one photo') ? null : prev));
  }

  function handleImagesChange(next) {
    setImagesState(next);
    clearImageSubmitError();
    // P6-T5: classify the FIRST image of each GROWING batch (§5.3's suggest-
    // from-photo moment). Shrinking (remove/reorder) must not re-classify.
    if (next.length > images.length) {
      requestSuggestion(next[0]);
    }
  }

  /**
   * P6-T5: ask the server what it sees in the photo. ADVISORY-ONLY (§16):
   * EVERY failure mode — transport error included — lands here and simply
   * leaves the form manual. classify() on the API never throws and always
   * 200s, so there is no error branch to surface to the user.
   */
  async function requestSuggestion(primaryImage) {
    const url = primaryImage?.url;
    if (!url || isEdit) return;
    setAiState('loading');
    try {
      const { suggestion } = await itemsApi.classify(url);
      if (suggestion) {
        // Pre-fill WITHOUT triggering validation (§13: a suggestion is a
        // pre-fill, not a validator — surfacing "Point value is required"
        // at fill time reads as an error the user caused) and CLEAR any
        // stale errors from an earlier submit attempt (classic flow:
        // submit empty → "required" errors → add photo → AI fills → the
        // old "Point value is required" must not linger). suggestedPoints
        // is FORMULA-derived (P6-T4) — routed through the same derivation
        // the user's own picks use, so there is exactly one points math.
        setValue('category', suggestion.suggestedCategory, { shouldDirty: true });
        setValue('condition', suggestion.suggestedCondition, { shouldDirty: true });
        recalculatePoints(suggestion.suggestedCategory, suggestion.suggestedCondition);
        clearErrors(['category', 'condition']);
        setAiFields({
          category: true,
          condition: true,
        });
        setAiState('ready');
      } else {
        setAiState('none'); // advisory null → stay manual, no error (§14.4)
      }
    } catch {
      setAiState('none'); // network failure → same manual fallback (§16)
    }
  }

  /** A user edit retires the "AI suggested" tag on that field (never locked). */
  function markEdited(field) {
    setAiFields((prev) => (prev[field] ? { ...prev, [field]: false } : prev));
  }

  // EDIT: load the item. Uses the same fetch conventions as the detail page
  // (query library is available, but a one-shot effect keeps the form's
  // load→prefill→reset lifecycle explicit and RHF-friendly).
  useEffect(() => {
    if (!isEdit) return undefined;
    let cancelled = false;
    setLoadError(null);
    itemsApi
      .getOne(id)
      .then((data) => {
        if (cancelled) return;
        setExisting(data.item);
        setImagesState(data.item.images ?? []);
        setTagsInput(tagsToInput(data.item.tags));
        reset({
          title: data.item.title,
          description: data.item.description,
          category: data.item.category,
          type: data.item.type,
          size: data.item.size,
          condition: data.item.condition,
          tags: data.item.tags ?? [],
          pointValue: data.item.pointValue,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message ?? 'Item not found.');
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, id, reset]);

  async function onSubmit(values) {
    setServerError(null);
    setNotice(null);

    const payload = {
      title: values.title,
      description: values.description,
      category: values.category,
      type: values.type,
      size: values.size,
      condition: values.condition,
      tags: parseTags(values.tags),
      pointValue: values.pointValue, // Session 12 fix: was MISSING — the API always 400'd VALIDATION "Point value is required" even with the field visibly filled (the RHF-state → payload mapping dropped it; tests only asserted images/tags, never pointValue)
      images: images.map((img) => ({
        url: img.url,
        isPrimary: Boolean(img.isPrimary),
        ...(img.perceptualHash ? { perceptualHash: img.perceptualHash } : {}),
      })),
    };

    if (images.length === 0) {
      setServerError('Add at least one photo before submitting.');
      return;
    }

    try {
      if (isEdit) {
        const data = await itemsApi.update(id, payload);
        push('Changes saved.', { tone: 'success' });
        navigate(`/items/${data.item._id}`, { replace: true });
      } else {
        const data = await itemsApi.create(payload);
        setCreated(data.item);
        setNotice(
          data.duplicateImageFlagged
            ? 'Heads up: one of your photos looks very similar to an existing listing. A moderator will take a look — this is not a rejection.'
            : null
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError('Please log in to continue.');
      } else {
        setServerError(err.message ?? 'Something went wrong. Please try again.');
      }
    }
  }

  async function onDelete() {
    setServerError(null);
    try {
      await itemsApi.remove(id);
      // §13 toast feedback: the delete is a SOFT delete (status=REMOVED) —
      // confirm the outcome, since the page navigates away immediately.
      push('Listing removed. You can see it in your items with its REMOVED badge.', {
        tone: 'success',
        action: { label: 'My items', to: '/dashboard/items' },
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setServerError(err.message ?? 'Could not delete this item.');
      setConfirmOpen(false);
    }
  }

  // ── Guard panels (each fully replaces the form — never `hidden` beside it) ──
  if (isEdit && loadError) {
    return (
      <section className="mx-auto max-w-xl">
        <div
          role="alert"
          className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-stone-200"
        >
          <p className="font-semibold text-stone-800">{loadError}</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block font-semibold text-brand-700 hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  if (isEdit && !existing && !loadError) {
    return (
      <div className="mx-auto max-w-xl" data-testid="form-loading">
        <div className="h-8 w-2/3 animate-pulse rounded bg-stone-200" />
        <div className="mt-4 h-64 animate-pulse rounded bg-stone-100" />
      </div>
    );
  }

  const notEditable = isEdit && existing && !EDITABLE_STATUSES.includes(existing.status);
  const isOwner =
    !isEdit ||
    (existing && existing.owner && String(existing.owner._id) === String(existing.ownerId));

  // Exactly ONE of these renders: the created panel, a guard panel, or the form.
  if (isEdit && notEditable) {
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-xl bg-amber-50 p-6 ring-1 ring-amber-200">
          <div className="flex items-center gap-2">
            <StatusBadge status={existing.status} />
            <h1 className="text-lg font-bold text-stone-900">This listing can&apos;t be edited</h1>
          </div>
          <p className="mt-2 text-sm text-stone-600">
            Items can only be edited while pending or approved. This item is{' '}
            {existing.status.toLowerCase().replace('_', ' ')}.
          </p>
          <Link
            to={`/items/${existing._id}`}
            className="mt-4 inline-block rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            View item
          </Link>
        </div>
      </section>
    );
  }

  if (isEdit && existing && !isOwner) {
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-xl bg-red-50 p-6 ring-1 ring-red-200" role="alert">
          <h1 className="text-lg font-bold text-stone-900">You can only edit your own items</h1>
          <Link
            to="/dashboard"
            className="mt-3 inline-block font-semibold text-brand-700 hover:underline"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  /** The §12 "AI suggested" tag — shown ONLY while the field is untouched. */
  function AiTag({ field }) {
    if (!aiFields[field]) return null;
    return (
      <span
        data-testid={`ai-tag-${field}`}
        className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-brand-700"
      >
        AI suggested
      </span>
    );
  }

  /** Scoped inline state for the AI suggestion (§23: form stays interactive). */
  function AiSuggestionState() {
    if (aiState === 'loading') {
      return (
        <p className="mt-1 text-sm text-stone-500" data-testid="ai-loading">
          Checking the photo for a suggested category…
        </p>
      );
    }
    if (aiState === 'none') {
      // §5.9: a silent no-op reads as a broken promise — the user keeps
      // wondering why fields are empty. Calm one-liner, NOT an alert:
      // this is the advisory degradation working as designed (§14.4/§16).
      return (
        <p className="mt-1 text-sm text-stone-500" data-testid="ai-none">
          No AI suggestion for this photo — fill the fields in manually.
        </p>
      );
    }
    return null; // idle/ready: the tags + table carry the message
  }

  return (
    <section className="mx-auto max-w-2xl">
      {created ? (
        <div className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-stone-200">
          <h1 className="text-2xl font-bold text-stone-900">Submitted for review</h1>
          <p className="mt-2 text-stone-600">
            “{created.title}” is now pending moderation. You&apos;ll see it on your dashboard and it
            will appear publicly once approved.
          </p>
          {notice && (
            <p
              className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
              role="status"
            >
              {notice}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Link
              to="/items"
              className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Browse items
            </Link>
            <Link
              to="/dashboard"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <h1 className="text-3xl font-bold text-stone-800">
            {isEdit ? 'Edit item' : 'List an item'}
          </h1>
          <p className="mt-2 text-stone-500">
            {isEdit
              ? 'Update the details of your listing.'
              : 'Give a pre-loved garment its next chapter. Photos upload right away — your text is safe even if an upload fails.'}
          </p>

          {serverError && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {serverError}
            </p>
          )}

          <div className="mt-6 space-y-5">
            <ImageUploader
              images={images}
              onChange={handleImagesChange}
              onError={clearImageSubmitError}
            />
            <AiSuggestionState />

            <Field id="title" label="Title" error={errors.title?.message}>
              <input
                id="title"
                type="text"
                autoComplete="off"
                {...registerField('title')}
                className={inputClass}
              />
            </Field>

            <Field id="description" label="Description" error={errors.description?.message}>
              <textarea
                id="description"
                rows={5}
                {...registerField('description')}
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field
                id="category"
                label={
                  <>
                    Category <AiTag field="category" />
                  </>
                }
                error={errors.category?.message}
              >
                {/* §13/§14.4: a dropdown like Condition, constrained to the
                    canonical list the AI picks from and browse chips show. */}
                <select
                  id="category"
                  {...registerField('category', {
                    onChange: (e) => {
                      markEdited('category');
                      recalculatePoints(e.target.value, watchCondition);
                    },
                  })}
                  className={inputClass}
                >
                  <option value="">Select category…</option>
                  {ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="type" label="Type" error={errors.type?.message}>
                <input
                  id="type"
                  type="text"
                  placeholder="e.g. Jacket"
                  {...registerField('type')}
                  className={inputClass}
                />
              </Field>

              <Field id="size" label="Size" error={errors.size?.message}>
                <input
                  id="size"
                  type="text"
                  placeholder="e.g. M"
                  {...registerField('size')}
                  className={inputClass}
                />
              </Field>

              <Field
                id="condition"
                label={
                  <>
                    Condition <AiTag field="condition" />
                  </>
                }
                error={errors.condition?.message}
              >
                <select
                  id="condition"
                  {...registerField('condition', {
                    onChange: (e) => {
                      markEdited('condition');
                      recalculatePoints(watchCategory, e.target.value);
                    },
                  })}
                  className={inputClass}
                >
                  <option value="">Select condition…</option>
                  {ITEM_CONDITION.map((c) => (
                    <option key={c} value={c}>
                      {c.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field id="tags" label="Tags (comma-separated)" error={errors.tags?.message}>
              {/* Raw controlled input, NOT registered: the shared schema
                  wants an ARRAY, so every keystroke syncs the parsed array
                  into RHF via setValue while the raw string stays in local
                  state (typing a trailing comma must not vanish). */}
              <input
                id="tags"
                type="text"
                value={tagsInput}
                placeholder="denim, vintage, everyday"
                onChange={(e) => {
                  setTagsInput(e.target.value);
                  setValue('tags', parseTags(e.target.value));
                }}
                className={inputClass}
              />
            </Field>

            <Field id="pointValue" label="Point value" error={errors.pointValue?.message}>
              {/* §14.4 revised (user request): points are NEVER user-decided —
                  they auto-compute from category × condition and the field is
                  read-only (typing 3000 is impossible; the server re-derives
                  regardless, so even a forged request cannot skew it). */}
              <input
                id="pointValue"
                type="number"
                min="1"
                max="1000"
                step="1"
                readOnly
                tabIndex={-1}
                {...registerField('pointValue')}
                data-testid="point-value-input"
                className={`${inputClass} cursor-default bg-stone-100 text-stone-600`}
                aria-readonly="true"
              />
              <p className="mt-1 text-sm text-stone-500">
                Calculated automatically: base points for the category × the condition multiplier.
                Pick a category and condition above.
              </p>
              <div
                data-testid="points-formula-table"
                className="mt-2 overflow-hidden rounded-lg bg-stone-50 ring-1 ring-stone-200"
              >
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-stone-500">
                      <th className="px-3 py-1.5 font-medium">Category</th>
                      <th className="px-3 py-1.5 font-medium">Base pts</th>
                      {ITEM_CONDITION.map((c) => (
                        <th key={c} className="px-3 py-1.5 font-medium" title={CONDITION_LABELS[c]}>
                          {c.replace('_', ' ')}
                          <span className="font-normal text-stone-450">
                            {' '}
                            ×{CONDITION_MULTIPLIERS[c]}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ITEM_CATEGORIES.map((cat) => (
                      <tr key={cat} className="border-t border-stone-200 text-stone-700">
                        <td className="px-3 py-1.5 font-medium">{cat}</td>
                        <td className="px-3 py-1.5">{BASE_POINTS[cat]}</td>
                        {ITEM_CONDITION.map((cond) => (
                          <td key={cond} className="px-3 py-1.5">
                            {computeSuggestedPoints(cat, cond)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Field>

            <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-5">
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Delete listing
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Submit for review'}
                </button>
                {confirmOpen && (
                  <ConfirmDialog
                    open
                    title="Delete this listing?"
                    message="This hides the item from ReWear permanently. Swap history stays intact."
                    confirmLabel="Delete"
                    danger
                    busy={isSubmitting}
                    onConfirm={onDelete}
                    onClose={() => setConfirmOpen(false)}
                  />
                )}
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
