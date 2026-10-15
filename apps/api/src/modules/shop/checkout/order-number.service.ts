import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';

import {
  OrderCounter,
  OrderCounterDocument,
} from '../schemas/order-counter.schema';

/** Mongo duplicate-key error, without importing the `mongodb` package. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * Allocates `TKR-20260925-0001`.
 *
 * The prefix comes from ORDER_NO_PREFIX so a rename does not need a code
 * change. Existing order numbers are deliberately NOT rewritten: an order
 * number is a customer-facing receipt reference and must never change once
 * it has been issued.
 *
 * Human-readable is the requirement (§5.1) — a customer reads this number
 * out on the phone, and a support agent types it back. That rules out a
 * raw ObjectId and rules in a per-day sequence.
 *
 * ── Deliberately NOT in the checkout transaction ────────────────────────
 * Every checkout of the day would otherwise contend on one counter
 * document, and fifty concurrent transactions writing one document is a
 * write-conflict storm: each abort retries the WHOLE checkout, including
 * the stock reservation. Allocating outside means a failed checkout
 * leaves a gap in the sequence. Gaps are fine; duplicate order numbers
 * and a five-second checkout are not.
 */
@Injectable()
export class OrderNumberService {
  private readonly prefix: string;

  constructor(
    @InjectModel(OrderCounter.name)
    private readonly counters: Model<OrderCounterDocument>,
    config: ConfigService,
  ) {
    this.prefix = config.getOrThrow<string>('orderNoPrefix');
  }

  async next(now: Date = new Date()): Promise<string> {
    const key = now.toISOString().slice(0, 10).replace(/-/g, '');

    // Concurrent upserts of a document that does not exist yet can BOTH
    // miss and both insert; one of them loses on the unique index. That
    // is a normal race, not a failure — the retry finds the document the
    // winner created and simply increments it.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const counter = await this.counters
          .findOneAndUpdate(
            { key },
            { $inc: { seq: 1 } },
            { upsert: true, new: true },
          )
          .lean<{ seq: number } | null>()
          .exec();

        if (counter) {
          return `${this.prefix}-${key}-${String(counter.seq).padStart(4, '0')}`;
        }
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }

    throw new InternalServerErrorException(
      'Could not allocate an order number',
    );
  }
}
