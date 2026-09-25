import { Types } from 'mongoose';

import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';

/**
 * What a CUSTOMER is allowed to see of an order.
 *
 * ── What is deliberately absent ─────────────────────────────────────────
 * `pricing.commissionPct`, `commissionAmount` and `vendorPayout` are on
 * the document and are never in this projection. They are the commercial
 * terms between the platform and the vendor; a customer who can read them
 * can work out every vendor's margin from a single order. The mapping
 * below is an allowlist for exactly that reason — a `...order.pricing`
 * spread would leak all three the day someone adds a field.
 *
 * `deliveryOtpHash` is `select: false` on the schema AND stripped by its
 * `toJSON`, and is not mapped here either. Three independent barriers,
 * because the OTP is the only thing standing between a stranger and
 * somebody's groceries.
 */
export interface OrderItemView {
  productId: string;
  name: string;
  image: string | null;
  unit: string;
  /** INTEGER PAISE. */
  price: number;
  qty: number;
  /** INTEGER PAISE. */
  lineTotal: number;
  fulfilled: boolean;
}

/** Every field INTEGER PAISE. */
export interface CustomerPricing {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
}

export interface OrderAddressView {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  location: { lat: number; lng: number };
  phone: string;
}

export interface StatusChangeView {
  from: OrderStatus | null;
  to: OrderStatus;
  byRole: Role | null;
  reason: string | null;
  at: string;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  placedAt: string;
  itemCount: number;
  /** INTEGER PAISE. */
  grandTotal: number;
  payment: { method: PaymentMethod; status: PaymentStatus };
  store: { id: string; storeName: string; slug: string } | null;
  /** First few item names, for the list row. */
  preview: string[];
}

export interface OrderDetail extends OrderSummary {
  items: OrderItemView[];
  pricing: CustomerPricing;
  address: OrderAddressView;
  statusHistory: StatusChangeView[];
  cancellation: {
    by: Role | null;
    reason: string | null;
    at: string | null;
  } | null;
  /** Set only once the order is actually cancellable without approval. */
  canCancel: boolean;
  acceptedAt: string | null;
  deliveredAt: string | null;
}

/** The lean shape both the orders and checkout services read. */
export interface OrderLean {
  _id: Types.ObjectId;
  orderNo: string;
  customerId: Types.ObjectId;
  vendorId: Types.ObjectId;
  deliveryPartnerId?: Types.ObjectId | null;
  items: {
    productId: Types.ObjectId;
    name: string;
    image?: string | null;
    unit: string;
    price: number;
    qty: number;
    lineTotal: number;
    fulfilled: boolean;
  }[];
  pricing: {
    itemsSubtotal: number;
    discount: number;
    deliveryFee: number;
    taxes: number;
    grandTotal: number;
  };
  address: {
    label?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    pincode: string;
    location: { type: 'Point'; coordinates: number[] };
    phone: string;
  };
  payment: { method: PaymentMethod; status: PaymentStatus };
  status: OrderStatus;
  statusHistory: {
    from?: OrderStatus | null;
    to: OrderStatus;
    byRole?: Role | null;
    reason?: string | null;
    at: Date;
  }[];
  cancellation?: {
    by?: Role | null;
    reason?: string | null;
    at?: Date | null;
  } | null;
  placedAt: Date;
  acceptedAt?: Date | null;
  deliveredAt?: Date | null;
}

export interface StoreRef {
  id: string;
  storeName: string;
  slug: string;
}

/**
 * Free cancellation ends the moment the vendor accepts (decision #8).
 *
 * After that the store has started picking the order, so cancelling is a
 * request for approval, not a right — and the API says so with a 409
 * rather than pretending the button will work.
 */
export const isFreelyCancellable = (status: OrderStatus): boolean =>
  status === OrderStatus.PLACED;

export function toOrderSummary(
  order: OrderLean,
  store: StoreRef | null,
): OrderSummary {
  return {
    id: order._id.toString(),
    orderNo: order.orderNo,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
    grandTotal: order.pricing.grandTotal,
    payment: { method: order.payment.method, status: order.payment.status },
    store,
    preview: order.items.slice(0, 3).map((item) => item.name),
  };
}

export function toOrderDetail(
  order: OrderLean,
  store: StoreRef | null,
): OrderDetail {
  const [lng, lat] = order.address.location.coordinates;

  return {
    ...toOrderSummary(order, store),
    items: order.items.map((item) => ({
      productId: item.productId.toString(),
      name: item.name,
      image: item.image ?? null,
      unit: item.unit,
      price: item.price,
      qty: item.qty,
      lineTotal: item.lineTotal,
      fulfilled: item.fulfilled,
    })),
    pricing: {
      itemsSubtotal: order.pricing.itemsSubtotal,
      discount: order.pricing.discount,
      deliveryFee: order.pricing.deliveryFee,
      taxes: order.pricing.taxes,
      grandTotal: order.pricing.grandTotal,
    },
    address: {
      label: order.address.label ?? null,
      line1: order.address.line1,
      line2: order.address.line2 ?? null,
      city: order.address.city,
      pincode: order.address.pincode,
      location: { lat, lng },
      phone: order.address.phone,
    },
    statusHistory: order.statusHistory.map((change) => ({
      from: change.from ?? null,
      to: change.to,
      byRole: change.byRole ?? null,
      reason: change.reason ?? null,
      at: change.at.toISOString(),
    })),
    cancellation: order.cancellation?.at
      ? {
          by: order.cancellation.by ?? null,
          reason: order.cancellation.reason ?? null,
          at: order.cancellation.at.toISOString(),
        }
      : null,
    canCancel: isFreelyCancellable(order.status),
    acceptedAt: order.acceptedAt ? order.acceptedAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
  };
}
