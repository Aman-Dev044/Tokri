/**
 * `GET /admin/reviews` — one row, EXACTLY as `ReviewsService.adminList`
 * returns it (`AdminReviewRow`). Same field names, same nullability.
 *
 * The fixture mirrors the ENDPOINT, never the screen: if the tab ever
 * needs a field the API does not send, the fix is on the API, not here.
 * A fixture shaped like the screen is how a 400 once rendered a perfectly
 * convincing dashboard of numbers nobody had computed.
 */
export interface AdminReviewRow {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  storeName: string;
  customerId: string;
  orderId: string;
  /** "Asha K." — what the public sees. */
  authorName: string;
  /** 1–5 */
  rating: number;
  comment: string | null;
  isHidden: boolean;
  hiddenReason: string | null;
  hiddenAt: string | null;
  createdAt: string;
  editedAt: string | null;
}

export const REVIEWS_FIXTURE: readonly AdminReviewRow[] = [
  {
    id: 'fx-review-1',
    productId: 'fx-p-mango',
    productName: 'Alphonso mango',
    vendorId: 'fx-store-hosur',
    storeName: 'Hosur Road Mandi',
    customerId: 'fx-cust-1',
    orderId: 'fx-order-2',
    authorName: 'Asha K.',
    rating: 5,
    comment: 'Sweet, ripe and packed carefully.',
    isHidden: false,
    hiddenReason: null,
    hiddenAt: null,
    createdAt: '2026-09-23T18:20:00+05:30',
    editedAt: null,
  },
  {
    id: 'fx-review-2',
    productId: 'fx-p-curd',
    productName: 'Set curd',
    vendorId: 'fx-store-dairy',
    storeName: 'Srinivasa Dairy & Bakery',
    customerId: 'fx-cust-2',
    orderId: 'fx-order-7',
    authorName: 'Rahul M.',
    rating: 2,
    comment: 'Sour by evening. Call me on the number on my order to discuss.',
    isHidden: true,
    hiddenReason: 'Asks other customers to phone them',
    hiddenAt: '2026-09-24T09:05:00+05:30',
    createdAt: '2026-09-23T21:40:00+05:30',
    editedAt: '2026-09-23T22:02:00+05:30',
  },
];
