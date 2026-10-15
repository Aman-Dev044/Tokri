/**
 * Proof-of-delivery photo: resize in the browser, then PUT straight to S3.
 *
 * Mirrors `lib/vendor/image.ts` — same shape of presign, same reason the
 * resize happens client-side (a phone photo is 4-8MB at a resolution nobody
 * needs for a delivery record) and the same reason the PUT bypasses
 * `api-client` (a presigned URL carries its own signature; an extra
 * Authorization header or `credentials: 'include'` invalidates it).
 *
 * `POST /delivery/orders/:id/proof-photo` takes `{ contentType, sizeBytes }`
 * and returns a presigned PUT — the same shape `POST /vendor/products/:id/
 * images` already uses. The resulting `publicUrl` is what `deliverOrder`
 * passes through as `photoUrl`.
 */

import { ApiError, api } from '@/lib/api-client';

/** Nothing on this surface needs a photo wider than this. */
const MAX_EDGE = 1600;

export class PhotoUploadError extends Error {
  /** true when S3 is simply not configured yet — a wiring gap, not a failure */
  readonly notConfigured: boolean;

  constructor(message: string, notConfigured = false) {
    super(message);
    this.name = 'PhotoUploadError';
    this.notConfigured = notConfigured;
  }
}

export interface PresignedUpload {
  uploadUrl: string;
  method: 'PUT';
  /** Must be sent VERBATIM — they are part of the signature. */
  headers: Record<string, string>;
  publicUrl: string;
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve(image);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoUploadError('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function resizeForUpload(file: File): Promise<{ blob: Blob; contentType: string }> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoUploadError('Pick an image file — JPEG, PNG or WebP.');
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
  if (!ctx) throw new PhotoUploadError('This browser cannot process images.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  let contentType = 'image/webp';
  let blob = await encode(canvas, contentType, 0.82);
  if (!blob || blob.type !== contentType) {
    contentType = 'image/jpeg';
    blob = await encode(canvas, contentType, 0.85);
  }
  if (!blob) throw new PhotoUploadError('The photo could not be re-encoded.');

  return { blob, contentType };
}

/**
 * Resize, ask the API for a presigned PUT, send the bytes to S3, return the
 * public HTTPS URL that `deliverOrder` accepts as `photoUrl`.
 *
 * The 503/501/404 the presign call may answer (storage not configured, or the
 * route not built yet on a worker that has not landed it) all collapse to the
 * same sentence: the rider can still confirm delivery with the OTP alone.
 */
export async function uploadProofPhoto(
  orderId: string,
  file: File,
  onProgress?: (phase: 'resizing' | 'signing' | 'uploading') => void,
): Promise<string> {
  onProgress?.('resizing');
  const resized = await resizeForUpload(file);

  onProgress?.('signing');
  let presigned: PresignedUpload;
  try {
    presigned = await api.post<PresignedUpload>(
      `/delivery/orders/${encodeURIComponent(orderId)}/proof-photo`,
      { contentType: resized.contentType, sizeBytes: resized.blob.size },
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.status === 503 || cause.status === 501 || cause.status === 404) {
        throw new PhotoUploadError(
          'Photo upload is not switched on yet. The delivery still completes on the code alone.',
          true,
        );
      }
      throw new PhotoUploadError(cause.friendlyMessage);
    }
    throw new PhotoUploadError('The upload could not be started.');
  }

  if (!presigned.uploadUrl || !presigned.publicUrl) {
    throw new PhotoUploadError(
      'Photo upload is not switched on yet — the server did not return an upload URL.',
      true,
    );
  }

  onProgress?.('uploading');
  let response: Response;
  try {
    response = await fetch(presigned.uploadUrl, {
      method: presigned.method,
      body: resized.blob,
      headers: presigned.headers,
    });
  } catch {
    throw new PhotoUploadError('The photo could not be sent. Check the connection and retry.');
  }

  if (!response.ok) {
    throw new PhotoUploadError(
      `Storage refused the upload (${response.status}). The signed link may have expired — try again.`,
    );
  }

  return presigned.publicUrl;
}
