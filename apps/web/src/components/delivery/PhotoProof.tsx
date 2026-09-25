'use client';

/**
 * Optional proof-of-delivery photo.
 *
 * `capture="environment"` opens the rear camera directly on a phone and falls
 * back to a file picker everywhere else — no getUserMedia, no permission
 * dance, no video element to leak. It is the right primitive for "take one
 * photo and move on".
 *
 * ── WHAT DOES NOT WORK YET, STATED PLAINLY ──────────────────────────────────
 * `POST /delivery/orders/:id/deliver` accepts `{ otp, photoUrl? }` — a URL,
 * which means the file has to be uploaded somewhere first. The vendor surface
 * gets `POST /vendor/products/:id/images → S3 presigned PUT` (§6.2); there is
 * NO equivalent for delivery yet.
 *
 * So the photo is captured, shown back to the rider, and NOT sent. The rider
 * is told that, rather than being allowed to believe a photo was filed. When
 * Worker C lands a presigned-upload endpoint, `onUploaded` is the one seam
 * that needs wiring.
 *
 * TODO(worker-c): a `POST /delivery/orders/:id/proof` presigned PUT, then
 * upload here and pass the returned URL into `deliverOrder`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './delivery.module.css';
import { IconCamera, IconX } from './icons';

export function PhotoProof({ disabled = false }: { disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  // An object URL is a live handle into the blob store. Not revoking it leaks
  // the whole image for the life of the document.
  useEffect(() => {
    return () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onPick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setPreview((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setName(file.name);
  }, []);

  const clear = useCallback(() => {
    setPreview((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return null;
    });
    setName(null);
    if (inputRef.current !== null) inputRef.current.value = '';
  }, []);

  return (
    <div className={styles.panelFlat}>
      <span className={styles.stepTag}>Photo proof — optional</span>

      <input
        ref={inputRef}
        className={styles.srOnly}
        id="rider-proof-photo"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={onPick}
      />

      {preview === null ? (
        <label
          className={styles.linkBtn}
          htmlFor="rider-proof-photo"
          style={{ marginTop: '0.5rem', width: '100%' }}
        >
          <IconCamera size={20} />
          Take a photo
        </label>
      ) : (
        <div style={{ marginTop: '0.5rem' }}>
          {/*
            A local blob preview, never remote. next/image would add a loader
            and a layout pass for a throwaway thumbnail, so a plain <img> is
            the right call here.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={name === null ? 'Proof photo' : `Proof photo: ${name}`}
            style={{ width: '100%', borderRadius: 'var(--r-panel)' }}
          />
          <button
            type="button"
            className={styles.ghost}
            onClick={clear}
            style={{ marginTop: '0.5rem' }}
          >
            <IconX size={18} /> Remove photo
          </button>
        </div>
      )}

      <p className={styles.lede} style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
        Photo uploads are not switched on yet, so this stays on your phone and is not
        sent with the delivery. The 4-digit code is what confirms it.
      </p>
    </div>
  );
}
