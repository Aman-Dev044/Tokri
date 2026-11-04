import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role, UserStatus } from '../../common/constants/roles.enum';
import { StaffRole } from '../../common/constants/permissions';

export type UserDocument = HydratedDocument<User>;

/**
 * What a STAFF account may do inside its store. `null` on every other role.
 *
 * ── Why it lives ON the user and not in a StoreStaff collection ─────────
 * `JwtStrategy` already loads the user on EVERY request to re-check
 * `status` and `role`. Putting the permissions in the same document means
 * the guard reads them in that same query — revoking one is effective on
 * the next request with zero extra round trips, and there is no second
 * document that can disagree with the first. Creating or deleting a staff
 * member is one insert or one delete, so no transaction is needed to keep
 * a login and its profile in step, and the existing unique phone/email
 * indexes already govern who can sign in.
 */
@Schema({ _id: false })
export class StaffProfile {
  @Prop({ type: String, enum: StaffRole, required: true })
  staffRole: StaffRole;

  /**
   * The resolved list at the time of the last write. Authoritative only
   * for CUSTOM — a preset resolves from `permissions.ts` so a preset
   * change reaches everybody on it. Unknown strings are dropped on read.
   */
  @Prop({ type: [String], default: [] })
  permissions: string[];

  /** Display only, e.g. "Morning counter". Never an authorization input. */
  @Prop({ type: String, default: null, trim: true })
  shiftLabel?: string | null;

  /** Who created the account — the owner or a manager. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;
}
export const StaffProfileSchema = SchemaFactory.createForClass(StaffProfile);

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  // No `sparse`/`index` here — the unique sparse index is declared once
  // below via UserSchema.index(), so Mongoose does not build it twice.
  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ required: true, trim: true })
  phone: string;

  /**
   * argon2id hash. The pepper (ARGON2_PEPPER) is applied at hash time and
   * lives only in the environment, so a stolen database alone is not
   * enough to mount an offline dictionary attack.
   *
   * `select: false` keeps the hash out of every query result unless a
   * caller explicitly asks for it.
   */
  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: String, enum: Role, required: true, index: true })
  role: Role;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  /** Set for VENDOR, STAFF and DELIVERY users. Drives tenant scoping. */
  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  /** Present only on Role.STAFF. See `StaffProfile` above. */
  @Prop({ type: StaffProfileSchema, default: null })
  staffProfile?: StaffProfile | null;

  /**
   * Refresh-token family id. Rotation issues a new token in the same
   * family; presenting an already-used token revokes the whole family,
   * which is what makes a stolen refresh token useless.
   */
  // Nullable fields need an explicit `type`: a `string | null` union is
  // ambiguous to Mongoose's reflection and throws CannotDetermineTypeError.
  @Prop({ type: String, default: null, select: false })
  refreshTokenFamily?: string | null;

  @Prop({ type: String, default: null, select: false })
  refreshTokenHash?: string | null;

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  /** Marks the bootstrap accounts created by the seed script. */
  @Prop({ default: false })
  isSystemAccount: boolean;

  /**
   * Marks an account planted by `seed:demo`.
   *
   * It is the ONLY thing `seed:demo --fresh` deletes. Without an explicit
   * marker, "wipe the demo data" degrades into "drop the collections",
   * which on a shared Atlas database takes the real accounts with it.
   */
  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ role: 1, vendorId: 1 });
UserSchema.index({ isDemo: 1 });

/** Never leak the hash or token material through a serialized response. */
UserSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    // Mongoose types `ret` as the hydrated document shape, which has no
    // index signature. Widening it here keeps the deletes type-safe.
    const out = ret as unknown as Record<string, unknown>;
    delete out.passwordHash;
    delete out.refreshTokenHash;
    delete out.refreshTokenFamily;
    delete out.__v;
    return out;
  },
});
