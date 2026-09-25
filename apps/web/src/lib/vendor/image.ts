'use client';

/**
 * Product photos: resize in the browser, then PUT straight to S3.
 *
 * ── WHY THE RESIZE HAPPENS HERE AND NOT ON THE SERVER ───────────────────────
 * A shop owner photographs a crate of tomatoes on a phone. That file is 4-8MB
 * of 4032×3024 JPEG, uploaded over a shop's 4G, to be displayed at 400px. The
 * canvas step turns it into roughly 80-200KB of WebP before a single byte
 * leaves the device — which is the difference between an upload that finishes
 * during a lull and one that is abandoned.
 *
 * WebP because every browser that supports `canvas.toBlob` with a quality
 * argument supports it, and it is ~30% smaller than JPEG at the same
 * perceptual quality. If the encoder refuses (a very old browser), we fall back
 * to JPEG rather than uploading the untouched original.
 *
 * ── WHY THE BYTES NEVER TOUCH OUR API ───────────────────────────────────────
 * `POST /vendor/products/:id/images` returns a presigned PUT (plan §6.2). The
 * file goes browser → S3 directly. Proxying it through the API would double the
 * bandwidth bill and put a 30-second request through the Node event loop for
 * every photo.
 *
 * The presigned PUT is sent with `fetch` directly and NOT through `api-client`:
 * that client attaches our Authorization header and `credentials: 'include'`,
 * and S3 rejects a presigned request that carries extra auth headers.
 */

import { ApiError, api } from '@/lib/api-client';
import type { PresignedUpload } from './types';

/** Nothing on any Mandi surface renders a product photo wider than this. */
export const MAX_EDGE = 1600;

export class ImageUploadError extends Error {
  /** true when S3 is simply not configured yet — a wiring gap, not a failure */
  readonly notConfigured: boolean;

  constructor(message: string, notConfigured = false) {
    super(message);
    this.name = 'ImageUploadError';
    this.notConfigured = notConfigured;
  }
}

/* ------------------------------------------------------------------ */
/* Resize                                                              */
/* ------------------------------------------------------------------ */

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      // Revoke on the next tick, not before the decode is read.
      resolve(image);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageUploadError('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export interface ResizedImage {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  /** what the original weighed, for the "4.2MB → 180KB" line in the drawer */
  originalBytes: number;
}

/**
 * Longest edge down to `MAX_EDGE`, re-encoded as WebP.
 *
 * An image already smaller than the cap is still re-encoded: a 900px 6MB PNG
 * is the other half of this problem, and the canvas pass fixes both.
 */
export async function resizeForUpload(file: File): Promise<ResizedImage> {
  if (!file.type.startsWith('image/')) {
    throw new ImageUploadError('Pick an image file — JPEG, PNG or WebP.');
  }

  const image = await loadBitmap(file);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageUploadError('This browser cannot process images.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  let contentType = 'image/webp';
  let blob = await encode(canvas, contentType, 0.82);

  if (!blob || blob.type !== contentType) {
    // Older Safari silently returns PNG when asked for WebP. JPEG is the
    // universally-honoured fallback, and still far smaller than the original.
    contentType = 'image/jpeg';
    blob = await encode(canvas, contentType, 0.85);
  }
  if (!blob) throw new ImageUploadError('The image could not be re-encoded.');

  return { blob, contentType, width, height, originalBytes: file.size };
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/**
 * Resize, ask the API for a presigned PUT, send the bytes to S3, return the
 * public URL.
 *
 * ── THE 503 ─────────────────────────────────────────────────────────────────
 * S3 is not wired up yet. The presign endpoint is expected to answer 503 (or
 * 501/404 while it does not exist at all) and this turns that into
 * `notConfigured`, which the drawer renders as a plain sentence: "image upload
 * is not configured yet". Not a stack trace, not a silent no-op, and not a
 * broken product record — the vendor can still save the product without a
 * photo and add one later.
 */
export async function uploadProductImage(
  productId: string,
  file: File,
  onProgress?: (phase: 'resizing' | 'signing' | 'uploading') => void,
): Promise<{ url: string; bytes: number; originalBytes: number }> {
  onProgress?.('resizing');
  const resized = await resizeForUpload(file);

  onProgress?.('signing');
  let presigned: PresignedUpload;
  try {
    presigned = await api.post<PresignedUpload>(`/vendor/products/${productId}/images`, {
      contentType: resized.contentType,
      bytes: resized.blob.size,
      width: resized.width,
      height: resized.height,
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      // 404/501 = the endpoint is not built yet. 503 = built, storage not
      // configured. All three are the same sentence to a shop owner.
      if (cause.status === 503 || cause.status === 501 || cause.status === 404) {
        throw new ImageUploadError(
          'Image upload is not configured yet. Save the product without a photo — you can add one once storage is switched on.',
          true,
        );
      }
      throw new ImageUploadError(cause.friendlyMessage);
    }
    throw new ImageUploadError('The upload could not be started.');
  }

  if (!presigned.uploadUrl || !presigned.publicUrl) {
    throw new ImageUploadError(
      'Image upload is not configured yet — the server did not return an upload URL.',
      true,
    );
  }

  onProgress?.('uploading');
  let response: Response;
  try {
    // Bare fetch, no credentials: a presigned URL carries its own signature and
    // S3 rejects the request if extra auth headers ride along.
    response = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      body: resized.blob,
      headers: { 'Content-Type': presigned.contentType },
    });
  } catch {
    throw new ImageUploadError('The photo could not be sent. Check the connection and retry.');
  }

  if (!response.ok) {
    throw new ImageUploadError(
      `Storage refused the upload (${response.status}). The signed link may have expired — try again.`,
    );
  }

  return {
    url: presigned.publicUrl,
    bytes: resized.blob.size,
    originalBytes: resized.originalBytes,
  };
}

/** `184320` -> `180 KB`. For the one line under the upload button. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
