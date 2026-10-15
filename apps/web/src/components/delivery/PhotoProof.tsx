'use client';

/**
 * Optional proof-of-delivery photo.
 *
 * `capture="environment"` opens the rear camera directly on a phone and falls
 * back to a file picker everywhere else — no getUserMedia, no permission
 * dance, no video element to leak. It is the right primitive for "take one
 * photo and move on".
 *
 * ── THE UPLOAD ───────────────────────────────────────────────────────────
 * Picking a file immediately kicks off `uploadProofPhoto` (resize → presign
 * → PUT to S3). `onUploaded` is called with the resulting HTTPS URL once it
 * lands, or with `null` if the photo is removed or the upload fails — either
 * way `ActiveJobView` only ever holds a URL it can actually pass to
 * `deliverOrder`, never a local blob URL.
 *
 * The delivery is never blocked on this: the 4-digit code from the customer
 * is what actually confirms it. A slow or failed upload just means the
 * delivery completes without a photo attached, which this component says
 * plainly rather than leaving the rider guessing whether it went through.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './delivery.module.css';
import { IconCamera, IconX } from './icons';
import { PhotoUploadError, uploadProofPhoto } from '@/lib/delivery/photo';

type UploadState = 'idle' | 'uploading' | 'done' | 'failed';

export function PhotoProof({
  orderId,
  disabled = false,
  onUploaded,
}: {
  orderId: string;
  disabled?: boolean;
  onUploaded: (photoUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);

  // An object URL is a live handle into the blob store. Not revoking it leaks
  // the whole image for the life of the document.
  useEffect(() => {
    return () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;

      setPreview((old) => {
        if (old !== null) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setName(file.name);
      setError(null);
      setState('uploading');
      onUploaded(null);

      void uploadProofPhoto(orderId, file)
        .then((url) => {
          setState('done');
          onUploaded(url);
        })
        .catch((cause: unknown) => {
          setState('failed');
          setError(
            cause instanceof PhotoUploadError
              ? cause.message
              : 'The photo could not be uploaded. The delivery still completes without it.',
          );
          onUploaded(null);
        });
    },
    [orderId, onUploaded],
  );

  const clear = useCallback(() => {
    setPreview((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return null;
    });
    setName(null);
    setState('idle');
    setError(null);
    onUploaded(null);
    if (inputRef.current !== null) inputRef.current.value = '';
  }, [onUploaded]);

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
        disabled={disabled || state === 'uploading'}
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
            style={{ width: '100%', borderRadius: 'var(--r-md)' }}
          />
          <button
            type="button"
            className={styles.ghost}
            onClick={clear}
            style={{ marginTop: '0.5rem' }}
            disabled={disabled}
          >
            <IconX size={18} /> Remove photo
          </button>
        </div>
      )}

      <p className={styles.lede} style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
        {state === 'uploading'
          ? 'Uploading…'
          : state === 'done'
            ? 'Attached to this delivery.'
            : state === 'failed'
              ? (error ?? 'The photo could not be uploaded.')
              : 'The 4-digit code is what confirms delivery — a photo is extra, not required.'}
      </p>
    </div>
  );
}
