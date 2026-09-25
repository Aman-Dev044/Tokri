'use client';

/**
 * ★ What the customer will actually see.
 *
 * A form is a list of fields; a product is a thing on a shelf. The gap between
 * the two is where "Amul Butter 500" gets listed with no unit and a photo of
 * somebody's thumb, and nobody notices until sales for that line are zero.
 *
 * So the drawer shows the card LIVE, from the same state the inputs are bound
 * to. Editing the price moves the price. Unticking "listed" greys the whole
 * card out. There is no save-and-check round trip.
 *
 * ── WHY THIS LOOKS LIKE THE SHOP AND NOT LIKE THE PANEL ─────────────────────
 * It is a quotation of the customer surface — editorial card, aisle hue, the
 * display face — which is exactly the thing the vendor panel otherwise refuses
 * to be (plan §2.4). That is the point: the preview is only useful if it is
 * honest about the other app. It sits inside a dashed frame labelled PREVIEW so
 * it can never be mistaken for the panel's own chrome, and `data-aisle` scopes
 * the aisle hue to this box alone.
 */

import type { AisleKey } from '@mandi/design-system';
import { formatPaise } from '@/lib/admin/format';
import type { ProductUnit } from '@/lib/vendor/types';

export interface ProductPreviewCardProps {
  name: string;
  brand: string;
  /** INTEGER PAISE */
  price: number;
  /** INTEGER PAISE */
  mrp: number;
  unit: ProductUnit;
  unitValue: number;
  aisleKey: AisleKey;
  images: string[];
  isActive: boolean;
}

export function ProductPreviewCard({
  name,
  brand,
  price,
  mrp,
  unit,
  unitValue,
  aisleKey,
  images,
  isActive,
}: ProductPreviewCardProps) {
  const off = mrp > price && mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const hero = images[0];

  return (
    <div className="ven-preview" data-aisle={aisleKey}>
      <p className="ven-preview__tag">Preview — how customers see it</p>

      <article className="ven-pcard" data-inactive={isActive ? undefined : 'true'}>
        <div className="ven-pcard__media">
          {hero ? (
            /* A blob: URL from the local resize preview has no loader and no
               known dimensions, so next/image cannot take it. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt="" />
          ) : (
            <span>No photo yet</span>
          )}
        </div>

        <div className="ven-pcard__body">
          {brand ? <span className="ven-pcard__brand">{brand}</span> : null}
          <h3 className="ven-pcard__name">{name || 'Untitled product'}</h3>
          <span className="ven-pcard__unit">
            {unitValue} {unit}
          </span>

          <div className="ven-pcard__prices">
            <span className="ven-pcard__price">{formatPaise(price)}</span>
            {off > 0 ? (
              <>
                <span className="ven-pcard__mrp">{formatPaise(mrp)}</span>
                <span className="ven-pcard__off">{off}% off</span>
              </>
            ) : null}
          </div>
        </div>
      </article>

      {!isActive ? (
        <p className="ven-field__hint" style={{ marginTop: 'var(--s-2)' }}>
          Not listed — customers cannot see or order this.
        </p>
      ) : null}
      {mrp > 0 && price > mrp ? (
        <p className="ven-field__error" style={{ marginTop: 'var(--s-2)' }}>
          The price is above the MRP. Customers will see a negative discount.
        </p>
      ) : null}
    </div>
  );
}
