/**
 * <ImageUploader> (§12 key reusable component; P5-T4, §5.3 upload-FIRST flow).
 *
 * Contract: `images` + `onChange` are owned by the caller (the item form) —
 * this component uploads files immediately via POST /items/images and hands
 * the returned [{ url, perceptualHash, isPrimary }] up. The form never
 * submits raw File objects; it submits server-returned image records
 * (§14.1: all uploads must succeed before the item is created, no partial
 * state).
 *
 * §5.9 recovery: client-side pre-checks (type/size/count) mirror the server
 * rules so obvious mistakes never burn an upload; server errors render
 * inline and every already-entered form field is untouched by a failed
 * upload — the uploader only ever replaces its own image list.
 */

import { useRef, useState } from 'react';

import * as itemsApi from '../../lib/api/items.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB — mirrors imageUpload.js
const MAX_FILES = 5; // mirrors imageUpload.js + itemCreateSchema

/**
 * Keep EXACTLY ONE primary across the whole list. The server marks the first
 * image of each upload REQUEST as primary (per-batch designation), so merging
 * two batches would otherwise leave two primaries — the first-ever image wins.
 */
function ensurePrimary(list) {
  if (list.length === 0) return list;
  const firstPrimaryIndex = list.findIndex((img) => img.isPrimary);
  if (firstPrimaryIndex === -1) {
    return list.map((img, i) => (i === 0 ? { ...img, isPrimary: true } : img));
  }
  return list.map((img, i) => ({ ...img, isPrimary: i === firstPrimaryIndex }));
}

export default function ImageUploader({ images, onChange, onError, disabled = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFiles(fileList) {
    setError(null);
    const picked = Array.from(fileList ?? []);
    if (picked.length === 0) return;

    for (const file of picked) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        onError?.();
        setError(`"${file.name}" is not a JPEG, PNG, or WebP image.`);
        return;
      }
      if (file.size > MAX_SIZE) {
        onError?.();
        setError(`"${file.name}" is larger than 5MB.`);
        return;
      }
    }
    if (images.length + picked.length > MAX_FILES) {
      onError?.();
      setError(`At most ${MAX_FILES} images per item — remove one first.`);
      return;
    }

    setUploading(true);
    try {
      const data = await itemsApi.uploadImages(picked);
      onChange(ensurePrimary([...images, ...data.images]));
    } catch (err) {
      onError?.();
      setError(err.message ?? 'Image upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeAt(index) {
    onChange(ensurePrimary(images.filter((_, i) => i !== index)));
  }

  function makePrimary(index) {
    onChange(images.map((img, i) => ({ ...img, isPrimary: i === index })));
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        data-testid="image-input"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        className="w-full rounded-xl border-2 border-dashed border-stone-300 px-4 py-8 text-center transition hover:border-brand-500 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="block font-semibold text-stone-700">
          {uploading ? 'Uploading…' : 'Add photos'}
        </span>
        <span className="mt-1 block text-sm text-stone-500">
          JPEG, PNG, or WebP · up to 5MB each · {images.length}/{MAX_FILES} used
        </span>
      </button>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-3">
          {images.map((img, i) => (
            <li
              key={`${img.url}-${i}`}
              className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-stone-200"
            >
              <div className="relative aspect-square bg-stone-100">
                <img
                  src={img.url}
                  alt={`Photo ${i + 1} of ${images.length}`}
                  className="h-full w-full object-cover"
                />
                {img.isPrimary && (
                  <span className="absolute left-1 top-1 rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold text-white">
                    Cover
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 p-1.5">
                <button
                  type="button"
                  onClick={() => makePrimary(i)}
                  disabled={disabled || img.isPrimary}
                  aria-label={`Set photo ${i + 1} as cover`}
                  className="rounded px-1.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                >
                  Cover
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  disabled={disabled || uploading}
                  aria-label={`Remove photo ${i + 1}`}
                  className="rounded px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
