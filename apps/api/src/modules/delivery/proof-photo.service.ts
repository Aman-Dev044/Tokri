import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Hard ceiling, mirrored by the DTO and signed into the URL. */
export const MAX_PROOF_PHOTO_BYTES = 5 * 1024 * 1024;

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
  /** Where the object will be readable once uploaded — this becomes `photoUrl`. */
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
 *  S3 PRESIGNED PUT — the delivery proof-photo half
 * ════════════════════════════════════════════════════════════════════════
 *
 * `POST /delivery/orders/:id/proof-photo` → a presigned S3 PUT, exactly
 * the same approach as the vendor's product-image presign in
 * `src/modules/vendor/catalog/images.service.ts`: SigV4 hand-rolled with
 * `node:crypto`, no AWS SDK dependency, path-style addressing so it
 * works against AWS S3, MinIO or any other S3-compatible endpoint. The
 * mechanics are intentionally duplicated rather than imported — the two
 * services sit in different modules (`vendor/catalog` is out of this
 * task's scope) and the object-key SHAPE differs (`orders/{orderId}/
 * proof/…` here vs. `vendors/{vendorId}/products/{productId}/…` there),
 * so sharing a class would mean threading a key-prefix parameter through
 * a file this task was told not to touch.
 *
 * Same two reasons the vendor version reads its config lazily, per call:
 * (1) the S3 variables are not provisioned on this deployment, and
 * failing at MODULE INIT would take the rider app's offers, order board
 * and location pings down with a bucket that was never configured; (2)
 * `getOrThrow` is still the read — §4.1 bans a fallback bucket name,
 * because uploads would then silently land somewhere nobody serves.
 * Its absence is therefore a clean 503 on this ONE endpoint, and the
 * rest of the delivery module keeps working.
 */
@Injectable()
export class DeliveryProofPhotoService {
  private readonly logger = new Logger(DeliveryProofPhotoService.name);

  constructor(private readonly config: ConfigService) {}

  presignProofPhoto(
    orderId: string,
    contentType: string,
    sizeBytes: number,
  ): PresignedUpload {
    const key =
      `orders/${orderId}/proof/${Date.now()}-` +
      `${randomBytes(8).toString('hex')}.${extensionFor(contentType)}`;

    return this.presign(key, contentType, sizeBytes);
  }

  /**
   * `POST /delivery/profile/kyc/document` — the same signing machinery,
   * a different key prefix.
   *
   * The key is namespaced by PARTNER and by document kind, and carries 8
   * random bytes: a KYC document is a photograph of a government
   * identity card, so the object name must not be guessable from the
   * rider id alone even if the bucket policy is ever loosened by
   * accident. Nothing about the number itself appears in the key.
   */
  presignKycDocument(
    partnerId: string,
    kind: string,
    contentType: string,
    sizeBytes: number,
  ): PresignedUpload {
    const key =
      `riders/${partnerId}/kyc/${kind}/${Date.now()}-` +
      `${randomBytes(16).toString('hex')}.${extensionFor(contentType)}`;

    return this.presign(key, contentType, sizeBytes);
  }

  /** SigV4 presigned PUT for one object key. */
  private presign(
    key: string,
    contentType: string,
    sizeBytes: number,
  ): PresignedUpload {
    const s3 = this.s3Config();

    const now = new Date();
    const amzDate = now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .slice(0, 15)
      .concat('Z');
    const dateStamp = amzDate.slice(0, 8);

    const base = new URL(s3.endpoint);
    const host = base.host;
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
      expiresAt: new Date(now.getTime() + EXPIRES_SECONDS * 1000).toISOString(),
      maxBytes: MAX_PROOF_PHOTO_BYTES,
    };
  }

  /** 503, not 500: correctly built, temporarily unable to do this one thing. */
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
        'Proof-photo upload requested but object storage is not configured. ' +
          'Set S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and ' +
          'S3_SECRET_ACCESS_KEY.',
      );
      throw new ServiceUnavailableException('image upload not configured');
    }
  }
}

/**
 * The file extension for an allowlisted content type.
 *
 * A lookup, not `contentType.split('/')[1]`: that yields `jpeg` for
 * `image/jpeg` (fine) but `pdf` only by luck and `svg+xml` for anything
 * the allowlist is ever widened to. The extension ends up in an object
 * key, so it must be a value this file chose, never one the caller
 * supplied a fragment of.
 */
function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/avif':
      return 'avif';
    case 'application/pdf':
      return 'pdf';
    default:
      // Unreachable: the DTO allowlist is checked before this is called.
      return 'bin';
  }
}

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
