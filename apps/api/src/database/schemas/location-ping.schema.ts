import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { GeoPoint, GeoPointSchema } from './geo-point';

export type LocationPingDocument = HydratedDocument<LocationPing>;

/**
 * One GPS fix from a rider who is out on a delivery (§5.1).
 *
 * The highest-volume collection in the platform by an order of magnitude:
 * one document every ten seconds per rider in flight. Everything about it
 * is shaped by that — it is append-only, it is never updated, and it
 * expires.
 */
@Schema({ timestamps: false, collection: 'location_pings' })
export class LocationPing {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  /** The DeliveryPartner `_id` — NOT the rider's User id. */
  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', required: true })
  partnerId: Types.ObjectId;

  /** GeoJSON [lng, lat]. Built through `point(lng, lat)`, never by hand. */
  @Prop({ type: GeoPointSchema, required: true })
  location: GeoPoint;

  @Prop({ type: Date, required: true })
  at: Date;

  /** Metres, as reported by the handset. Null when the device omits it. */
  @Prop({ type: Number, default: null })
  accuracy?: number | null;

  /** Degrees clockwise from north, 0-359. Drives the map arrow. */
  @Prop({ type: Number, default: null })
  heading?: number | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const LocationPingSchema = SchemaFactory.createForClass(LocationPing);

// ── Indexes ───────────────────────────────────────────────────────────
// { orderId, at:-1 } — the tracking screen's breadcrumb query.
LocationPingSchema.index({ orderId: 1, at: -1 });

/**
 * THE TTL (§8.7).
 *
 * Seven days, after which MongoDB deletes the document itself. Without
 * this the collection grows without bound and is the first thing to fill
 * the disk — a rider on a 30-minute delivery writes ~180 documents, and
 * nothing ever reads a breadcrumb from last month.
 *
 * `expireAfterSeconds` on `at` (a real Date), so the clock is the ping's
 * own timestamp rather than an insertion side effect.
 */
LocationPingSchema.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
