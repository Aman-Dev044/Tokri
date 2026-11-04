import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import {
  Setting,
  SettingDocument,
} from '../../src/database/schemas/setting.schema';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/**
 * `GET /settings/public` — reachable without a token, and it exposes
 * EXACTLY six keys. The second half is the point: the settings collection
 * also holds commission, the COD ceiling, maintenance mode and the ops
 * thresholds, and none of them may reach a signed-out caller.
 */
const PUBLIC_KEYS = [
  'deliveryFeePaise',
  'freeDeliveryThresholdPaise',
  'platformName',
  'serviceRadiusKm',
  'supportEmail',
  'supportPhone',
];

describe('GET /settings/public', () => {
  let ctx: TestContext;
  let server: Server;
  let settings: Model<SettingDocument>;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    settings = ctx.app.get(getModelToken(Setting.name));
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  afterEach(async () => {
    await settings.deleteMany({});
  });

  it('answers an anonymous caller with the defaults and nothing else', async () => {
    const res = await request(server)
      .get('/settings/public')
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(PUBLIC_KEYS);
    expect(res.body).toEqual({
      platformName: 'Tokri',
      supportEmail: 'support@tokri.app',
      supportPhone: '9000000000',
      deliveryFeePaise: 2900,
      freeDeliveryThresholdPaise: 49900,
      serviceRadiusKm: 5,
    });
  });

  it('returns stored values, and never the sensitive keys stored beside them', async () => {
    await settings.insertMany([
      { key: 'platformName', value: 'Tokri Test' },
      { key: 'supportEmail', value: 'help@example.com' },
      { key: 'supportPhone', value: '9123456789' },
      { key: 'deliveryFeePaise', value: 1900 },
      { key: 'freeDeliveryThresholdPaise', value: 29900 },
      { key: 'serviceRadiusKm', value: 7 },
      // Everything below must stay private.
      { key: 'defaultCommissionPct', value: 15 },
      { key: 'codMaxAmountPaise', value: 150000 },
      { key: 'maintenanceMode', value: true },
      { key: 'slaMinutes', value: 25 },
      { key: 'stuckOrderGraceMinutes', value: 12 },
      { key: 'someFutureSecret', value: 'do-not-leak' },
    ]);

    const res = await request(server)
      .get('/settings/public')
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object).sort()).toEqual(PUBLIC_KEYS);
    expect(res.body).toEqual({
      platformName: 'Tokri Test',
      supportEmail: 'help@example.com',
      supportPhone: '9123456789',
      deliveryFeePaise: 1900,
      freeDeliveryThresholdPaise: 29900,
      serviceRadiusKm: 7,
    });

    const raw = JSON.stringify(res.body);
    for (const leaked of [
      'defaultCommissionPct',
      'codMaxAmountPaise',
      'maintenanceMode',
      'slaMinutes',
      'stuckOrderGraceMinutes',
      'someFutureSecret',
      'do-not-leak',
      'updatedBy',
      'updatedAt',
    ]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it('falls back to the default when a stored value has the wrong type', async () => {
    await settings.insertMany([
      { key: 'deliveryFeePaise', value: '1900' },
      { key: 'supportEmail', value: 42 },
    ]);

    const res = await request(server)
      .get('/settings/public')
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body.deliveryFeePaise).toBe(2900);
    expect(res.body.supportEmail).toBe('support@tokri.app');
  });
});
