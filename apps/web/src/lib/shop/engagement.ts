/**
 * The wishlist and review shapes — mirrored from the RUNNING API, like
 * everything in `types.ts`, with the same narrowing readers:
 *
 *   WishlistRow    GET  /wishlist                       → WishlistRow[] (bare array)
 *   ReviewPage     GET  /products/:id/reviews           → { data, meta, summary }
 *   MyReview       GET  /products/:id/reviews/mine      → MyReviewState
 *   ReviewRow      POST /products/:id/reviews           → ReviewRow & { isHidden }
 *                  PATCH /products/:id/reviews/mine     → ReviewRow & { isHidden }
 *
 * Kept in its own file so `types.ts` — which every shop screen imports —
 * does not grow by two features' worth of readers.
 */

import { isDict, readPaged, readProduct, type Paged, type Product } from './types';

type Dict = Record<string, unknown>;

function str(source: Dict, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(source: Dict, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(source: Dict, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

/* ══════════════════════════════ wishlist ═══════════════════════════════ */

export type WishlistUnavailableReason = 'deleted' | 'inactive' | 'store_unavailable';

function isUnavailableReason(value: unknown): value is WishlistUnavailableReason {
  return value === 'deleted' || value === 'inactive' || value === 'store_unavailable';
}

export interface WishlistStore {
  id: string;
  slug: string;
  storeName: string;
  isOpen: boolean;
}

/**
 * One saved product. A withdrawn or deleted product, or one whose store is
 * no longer approved, stays on the list with `available: false` and the
 * reason — the API never drops it, so neither does this reader.
 */
export interface WishlistRow {
  productId: string;
  addedAt: string;
  available: boolean;
  unavailableReason: WishlistUnavailableReason | null;
  name: string;
  image: string | null;
  /** Live catalogue data; null only when the product was deleted. */
  product: (Product & { isActive: boolean }) | null;
  store: WishlistStore | null;
}

function readWishlistStore(value: unknown): WishlistStore | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    slug: str(value, 'slug') ?? id,
    storeName: str(value, 'storeName') ?? 'Store',
    isOpen: bool(value, 'isOpen') ?? false,
  };
}

export function readWishlistRow(value: unknown): WishlistRow | null {
  if (!isDict(value)) return null;
  const productId = str(value, 'productId');
  if (productId === null) return null;

  const base = readProduct(value['product']);
  const productRaw = value['product'];
  const reason = value['unavailableReason'];

  return {
    productId,
    addedAt: str(value, 'addedAt') ?? '',
    available: bool(value, 'available') ?? false,
    unavailableReason: isUnavailableReason(reason) ? reason : null,
    name: str(value, 'name') ?? base?.name ?? 'Saved item',
    image: str(value, 'image'),
    product:
      base === null || !isDict(productRaw)
        ? null
        : { ...base, isActive: bool(productRaw, 'isActive') ?? false },
    store: readWishlistStore(value['store']),
  };
}

/** The endpoint returns a BARE ARRAY — every saved id, for the hearts. */
export function readWishlist(value: unknown): WishlistRow[] {
  if (!Array.isArray(value)) return [];
  const out: WishlistRow[] = [];
  for (const row of value) {
    const parsed = readWishlistRow(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/* ══════════════════════════════ reviews ════════════════════════════════ */

export const REVIEW_COMMENT_MAX = 500;

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  /** "Asha K." — never more than a first name and an initial. */
  authorName: string;
  createdAt: string;
  editedAt: string | null;
}

export interface MyReview extends Review {
  /** Hidden by a moderator. The author still sees it; nobody else does. */
  isHidden: boolean;
}

export interface ReviewPage extends Paged<Review> {
  summary: { average: number; count: number };
}

export interface MyReviewState {
  canReview: boolean;
  reason: 'NOT_PURCHASED' | null;
  review: MyReview | null;
}

export function readReview(value: unknown): Review | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  const rating = num(value, 'rating');
  if (id === null || rating === null) return null;
  return {
    id,
    rating,
    comment: str(value, 'comment'),
    authorName: str(value, 'authorName') ?? 'A customer',
    createdAt: str(value, 'createdAt') ?? '',
    editedAt: str(value, 'editedAt'),
  };
}

export function readMyReview(value: unknown): MyReview | null {
  const base = readReview(value);
  if (base === null || !isDict(value)) return null;
  return { ...base, isHidden: bool(value, 'isHidden') ?? false };
}

export function readReviewPage(value: unknown): ReviewPage {
  const page = readPaged(value, readReview);
  const summary = isDict(value) && isDict(value['summary']) ? value['summary'] : null;
  return {
    ...page,
    summary: {
      average: summary === null ? 0 : (num(summary, 'average') ?? 0),
      count: summary === null ? 0 : (num(summary, 'count') ?? 0),
    },
  };
}

export function readMyReviewState(value: unknown): MyReviewState {
  if (!isDict(value)) return { canReview: false, reason: null, review: null };
  return {
    canReview: bool(value, 'canReview') ?? false,
    reason: value['reason'] === 'NOT_PURCHASED' ? 'NOT_PURCHASED' : null,
    review: readMyReview(value['review']),
  };
}

/** "4.3" — one decimal, the precision the API stores. */
export function formatRating(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}
