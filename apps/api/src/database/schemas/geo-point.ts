import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * A GeoJSON point, the only shape MongoDB's `2dsphere` index accepts.
 *
 * COORDINATE ORDER IS [longitude, latitude] — not the [lat, lng] order
 * every mapping UI uses. Reversing the pair does not error; it silently
 * places a Bengaluru store in the Indian Ocean and makes every radius
 * query return nothing. Every writer goes through `point(lng, lat)`.
 */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates: number[];
}

export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

/** Builds a GeoJSON point from an explicit (lng, lat) pair. */
export const point = (lng: number, lat: number): GeoPoint => ({
  type: 'Point',
  coordinates: [lng, lat],
});
