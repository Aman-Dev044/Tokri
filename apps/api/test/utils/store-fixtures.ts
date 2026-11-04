import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../src/database/schemas/vendor.schema';
import {
  Category,
  CategoryDocument,
} from '../../src/database/schemas/category.schema';
import {
  Product,
  ProductDocument,
  ProductUnit,
} from '../../src/database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../src/database/schemas/inventory.schema';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { TestContext, nextIp } from './test-app';

/**
 * Seeding for the store-staff and POS specs.
 *
 * Every password is GENERATED per run — never a literal — exactly as the
 * other specs do. A fixture credential is one paste away from production.
 */
export const runPassword = (): string =>
  `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

let counter = 0;
/** Unique within a spec — each spec boots its own in-memory database. */
export const uniquePhone = (): string =>
  `93${String(++counter).padStart(8, '0')}`;

export interface SeededProduct {
  id: string;
  name: string;
  price: number;
  mrp: number;
  barcode: string | null;
}

export interface SeededStore {
  vendorId: string;
  slug: string;
  ownerId: string;
  ownerPhone: string;
  ownerToken: string;
  categoryId: string;
  products: SeededProduct[];
}

export class StoreSeeder {
  readonly users: Model<UserDocument>;
  readonly vendors: Model<VendorDocument>;
  readonly categories: Model<CategoryDocument>;
  readonly products: Model<ProductDocument>;
  readonly inventory: Model<InventoryDocument>;
  readonly passwords: PasswordService;
  readonly server: Server;

  constructor(
    ctx: TestContext,
    readonly password: string,
  ) {
    this.server = ctx.app.getHttpServer() as Server;
    this.users = ctx.app.get(getModelToken(User.name));
    this.vendors = ctx.app.get(getModelToken(Vendor.name));
    this.categories = ctx.app.get(getModelToken(Category.name));
    this.products = ctx.app.get(getModelToken(Product.name));
    this.inventory = ctx.app.get(getModelToken(Inventory.name));
    this.passwords = ctx.app.get(PasswordService);
  }

  async user(
    role: Role,
    vendorId: Types.ObjectId | null,
    name = `Seed ${role} ${++counter}`,
  ): Promise<UserDocument> {
    return this.users.create({
      name,
      phone: uniquePhone(),
      passwordHash: await this.passwords.hash(this.password),
      role,
      status: UserStatus.ACTIVE,
      vendorId,
    });
  }

  async login(identifier: string, password = this.password): Promise<request.Response> {
    return request(this.server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier, password });
  }

  async token(identifier: string, password = this.password): Promise<string> {
    const res = await this.login(identifier, password);
    if (res.status !== 200) {
      throw new Error(`login ${identifier} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.accessToken as string;
  }

  /**
   * A store with an owner and the given products, each with its own
   * inventory row. `stock` defaults to 50.
   */
  async store(
    label: string,
    products: {
      name: string;
      price: number;
      mrp: number;
      stock?: number;
      barcode?: string | null;
      isActive?: boolean;
    }[],
  ): Promise<SeededStore> {
    const vendorId = new Types.ObjectId();
    const owner = await this.user(Role.VENDOR, vendorId, `${label} Owner`);
    const slug = `${label.toLowerCase()}-store-${Date.now()}-${++counter}`;

    await this.vendors.create({
      _id: vendorId,
      ownerId: owner._id,
      storeName: `${label} Store`,
      slug,
      address: {
        line1: '1 Market Lane',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      location: { type: 'Point', coordinates: [73.8567, 18.5204] },
      commissionPct: 12,
      status: VendorStatus.APPROVED,
      isOpen: true,
    });

    const category = await this.categories.create({
      vendorId,
      name: `${label} Shelf`,
      slug: `${label.toLowerCase()}-shelf-${counter}`,
      aisleKey: AisleKey.VEGETABLES,
    });

    const seeded: SeededProduct[] = [];
    for (const [index, spec] of products.entries()) {
      const product = await this.products.create({
        vendorId,
        categoryId: category._id,
        name: spec.name,
        slug: `${label.toLowerCase()}-p${index}-${counter}`,
        unit: ProductUnit.G,
        unitValue: 500,
        sku: `${label.toUpperCase()}-${index}`,
        barcode: spec.barcode ?? null,
        mrp: spec.mrp,
        price: spec.price,
        isActive: spec.isActive ?? true,
        searchText: spec.name.toLowerCase(),
      });
      await this.inventory.create({
        vendorId,
        productId: product._id,
        stock: spec.stock ?? 50,
        reserved: 0,
        lowStockThreshold: 5,
      });
      seeded.push({
        id: product._id.toString(),
        name: spec.name,
        price: spec.price,
        mrp: spec.mrp,
        barcode: spec.barcode ?? null,
      });
    }

    return {
      vendorId: vendorId.toString(),
      slug,
      ownerId: owner._id.toString(),
      ownerPhone: owner.phone,
      ownerToken: await this.token(owner.phone),
      categoryId: category._id.toString(),
      products: seeded,
    };
  }

  /** An authenticated request with a fresh source IP. */
  as(
    token: string,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
  ): request.Test {
    return request(this.server)
      [method](path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);
  }
}
