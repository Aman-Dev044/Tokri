import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Hard ceiling, mirrored by the DTO and signed into the URL. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How long a signed PUT stays valid. Long enough for a slow 3G upload. */
const EXPIRES_SECONDS = 900;

export interface PresignedUpload {
  /** The signed URL. PUT the bytes here, nothing else. */
  uploadUrl: string;
  method: 'PUT';
  /** Must be sent VERBATIM — they are part of the signature. */
  headers: Record<string, string>;
  /** Object key inside the bucket. */
  key: string;
  /** Where the object will be readable once uploaded. */
  publicUrl: string;
  expiresAt: string;
  maxBytes: number;
}

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  S3 PRESIGNED PUT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Why the API never sees the bytes ────────────────────────────────────
 * A 5 MB upload through the API is 5 MB of heap, a long-held connection
 * and a request that cannot be retried cheaply. Presigning moves the
 * transfer to object storage and leaves the API doing arithmetic.
 *
 * ── Why the config is read lazily ───────────────────────────────────────
 * The S3 variables are not provisioned yet. Reading them in the
 * constructor with `getOrThrow` would make the WHOLE MODULE fail at boot
 * — so a missing storage bucket would take the order board, the inventory
 * screen and the earnings report down with it. They are therefore read on
 * the request that actually needs them, and their absence is a clean 503
 * on one endpoint.
 *
 * It is still `getOrThrow`, never a fallback: §4.1 is absolute. A default
 * bucket name would mean uploads silently land somewhere nobody serves.
 *
 * ── Why the signature covers content-length and content-type ────────────
 * A presigned PUT that signs only `host` accepts a file of any size and
 * any type — the "5 MB, images only" rule would live entirely in the
 * browser, where an attacker with a vendor token simply skips it. Signing
 * both headers makes S3 itself reject anything else.
 */
@Injectable()
export class VendorImagesService {
  private readonly logger = new Logger(VendorImagesService.name);

  constructor(private readonly config: ConfigService) {}

  presignProductImage(
    vendorScope: string,
    productId: string,
    contentType: string,
    sizeBytes: number,
  ): PresignedUpload {
    const s3 = this.s3Config();

    const extension = contentType.slice('image/'.length);
    const key =
      `vendors/${vendorScope}/products/${productId}/` +
      `${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`;

    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .slice(0, 15)
      .concat('Z');
    const dateStamp = amzDate.slice(0, 8);

    const base = new URL(s3.endpoint);
    const host = base.host;
    // Path-style addressing: it works on AWS S3, MinIO and every
    // S3-compatible endpoint, where virtual-host style needs DNS the
    // deployment may not own.
    const basePath = base.pathname.replace(/\/+$/, '');
    const canonicalUri = `${basePath}/${s3.bucket}/${key}`
      .split('/')
      .map((segment, index) => (index === 0 ? segment : encodeRfc3986(segment)))
      .join('/');

    const credentialScope = `${dateStamp}/${s3.region}/s3/aws4_request`;
    const signedHeaders = 'content-length;content-type;host';

    const query: [string, string][] = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${s3.accessKeyId}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(EXPIRES_SECONDS)],
      ['X-Amz-SignedHeaders', signedHeaders],
    ];

    const canonicalQuery = query
      .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
      .sort()
      .join('&');

    const canonicalHeaders =
      `content-length:${sizeBytes}\n` +
      `content-type:${contentType}\n` +
      `host:${host}\n`;

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      // The body is not available to sign, and re-reading it would defeat
      // the point of presigning. UNSIGNED-PAYLOAD is the documented
      // answer; the content-length and content-type bindings above are
      // what keep it honest.
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signature = hmac(
      signingKey(s3.secretAccessKey, dateStamp, s3.region),
      stringToSign,
    ).toString('hex');

    const uploadUrl =
      `${base.origin}${canonicalUri}?${canonicalQuery}` +
      `&X-Amz-Signature=${signature}`;

    return {
      uploadUrl,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(sizeBytes),
      },
      key,
      publicUrl: `${base.origin}${canonicalUri}`,
      expiresAt: new Date(
        now.getTime() + EXPIRES_SECONDS * 1000,
      ).toISOString(),
      maxBytes: MAX_IMAGE_BYTES,
    };
  }

  /**
   * Reads the five storage variables, or refuses the request.
   *
   * 503 and not 500: the service is correctly built and temporarily
   * unable to do this one thing, which is exactly what 503 means. The
   * operator reads the log line; the vendor reads a sentence that tells
   * them it is not their fault.
   */
  private s3Config(): S3Config {
    try {
      return {
        endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
        region: this.config.getOrThrow<string>('S3_REGION'),
        bucket: this.config.getOrThrow<string>('S3_BUCKET'),
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      };
    } catch {
      this.logger.error(
        'Image upload requested but object storage is not configured. ' +
          'Set S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and ' +
          'S3_SECRET_ACCESS_KEY, then add them to env.validation.ts.',
      );
      throw new ServiceUnavailableException('image upload not configured');
    }
  }
}

/**
 * AWS wants RFC 3986 encoding, which differs from `encodeURIComponent`
 * on `!`, `'`, `(`, `)` and `*`. A single mismatched character produces a
 * SignatureDoesNotMatch that is invisible until upload time.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const date = hmac(`AWS4${secret}`, dateStamp);
  const regional = hmac(date, region);
  const service = hmac(regional, 's3');
  return hmac(service, 'aws4_request');
}
