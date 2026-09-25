import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import {
  Address,
  AddressDocument,
} from '../../../database/schemas/address.schema';
import { point } from '../../../database/schemas/geo-point';
import { CreateAddressDto, UpdateAddressDto } from './dto';

export interface AddressView {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  location: { lat: number; lng: number };
  phone: string;
  isDefault: boolean;
}

interface AddressLean {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  pincode: string;
  location: { type: 'Point'; coordinates: number[] };
  phone: string;
  isDefault: boolean;
}

/**
 * The customer's saved addresses.
 *
 * Every query carries `customerId` from the verified token as well as the
 * id from the path. `ResourceOwnerGuard` has already checked ownership on
 * the single-resource routes, so this is the second of two independent
 * checks — the guard could be removed from a route by accident, and the
 * query would still refuse to return somebody else's address.
 */
@Injectable()
export class AddressesService {
  constructor(
    @InjectModel(Address.name)
    private readonly addresses: Model<AddressDocument>,
  ) {}

  async list(customerId: string): Promise<AddressView[]> {
    const rows = await this.addresses
      .find({ customerId: new Types.ObjectId(customerId) })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean<AddressLean[]>()
      .exec();

    return rows.map((row) => this.toView(row));
  }

  async findOne(customerId: string, id: string): Promise<AddressView> {
    return this.toView(await this.owned(customerId, id));
  }

  /**
   * The FIRST address a customer saves is always the default, whatever
   * the request said. An account with addresses but no default makes
   * every checkout start with an empty address field.
   */
  async create(
    customerId: string,
    dto: CreateAddressDto,
  ): Promise<AddressView> {
    const owner = new Types.ObjectId(customerId);
    const count = await this.addresses.countDocuments({ customerId: owner });
    const isDefault = dto.isDefault === true || count === 0;

    if (isDefault) await this.demoteOthers(owner);

    const created = await this.addresses.create({
      customerId: owner,
      label: dto.label ?? 'Home',
      line1: dto.line1,
      line2: dto.line2 ?? null,
      city: dto.city,
      pincode: dto.pincode,
      location: point(dto.lng, dto.lat),
      phone: dto.phone,
      isDefault,
    });

    return this.toView(created.toObject<AddressLean>());
  }

  async update(
    customerId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<AddressView> {
    const owner = new Types.ObjectId(customerId);
    const existing = await this.owned(customerId, id);

    if (dto.isDefault === true) await this.demoteOthers(owner, existing._id);

    const patch: Record<string, unknown> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.line1 !== undefined) patch.line1 = dto.line1;
    if (dto.line2 !== undefined) patch.line2 = dto.line2;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.pincode !== undefined) patch.pincode = dto.pincode;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;

    // Both or neither: half a coordinate pair would move the pin into the
    // sea without changing the street it claims to be on.
    if (dto.lat !== undefined && dto.lng !== undefined) {
      patch.location = point(dto.lng, dto.lat);
    }

    const updated = await this.addresses
      .findOneAndUpdate({ _id: existing._id, customerId: owner }, patch, {
        new: true,
      })
      .lean<AddressLean | null>()
      .exec();

    if (!updated) throw new NotFoundException('Address not found');
    return this.toView(updated);
  }

  /**
   * Deleting the default promotes the next most recent address.
   *
   * Leaving the account with no default is the same broken checkout as
   * never having set one.
   */
  async remove(customerId: string, id: string): Promise<{ deleted: true }> {
    const owner = new Types.ObjectId(customerId);
    const existing = await this.owned(customerId, id);

    await this.addresses
      .deleteOne({ _id: existing._id, customerId: owner })
      .exec();

    if (existing.isDefault) {
      const next = await this.addresses
        .findOne({ customerId: owner })
        .sort({ updatedAt: -1 })
        .exec();

      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    return { deleted: true };
  }

  /** Used by checkout: the address must exist AND belong to the buyer. */
  async owned(
    customerId: string,
    id: string,
    session?: ClientSession,
  ): Promise<AddressLean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Address not found');
    }

    const row = await this.addresses
      .findOne({
        _id: new Types.ObjectId(id),
        customerId: new Types.ObjectId(customerId),
      })
      .session(session ?? null)
      .lean<AddressLean | null>()
      .exec();

    // 404, never 403 — see ResourceOwnerGuard for why the two cases must
    // be indistinguishable.
    if (!row) throw new NotFoundException('Address not found');
    return row;
  }

  private async demoteOthers(
    owner: Types.ObjectId,
    except?: Types.ObjectId,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      customerId: owner,
      isDefault: true,
    };
    if (except) filter._id = { $ne: except };

    await this.addresses.updateMany(filter, { isDefault: false }).exec();
  }

  private toView(row: AddressLean): AddressView {
    const [lng, lat] = row.location.coordinates;
    return {
      id: row._id.toString(),
      label: row.label,
      line1: row.line1,
      line2: row.line2 ?? null,
      city: row.city,
      pincode: row.pincode,
      location: { lat, lng },
      phone: row.phone,
      isDefault: row.isDefault,
    };
  }
}
