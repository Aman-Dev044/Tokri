'use client';

/**
 * A full-bleed produce ticker: two rows of real stock with real rupee prices,
 * scrolling in opposite directions between hairline rules. It is the "shop
 * window" of the page - the thing that makes it read as a market rather than a
 * software product.
 *
 * Every price is set in Azeret Mono with tabular figures, because a price is
 * data and Mandi sets data in the mono face. Amounts are integer paise
 * (plan section 5.2) and pass through formatPaise, the single place paise turns
 * into a rupee string.
 *
 * Accessibility / motion:
 *  - the whole strip is aria-hidden: it is decorative repetition, and a screen
 *    reader reading forty prices twice is noise. The aisle showcase below
 *    carries the same items in a real, readable list.
 *  - hovering or focusing anywhere in the strip pauses it
 *  - prefers-reduced-motion stops the scroll entirely and turns the row into an
 *    ordinary horizontally-scrollable strip (handled in marketing.css)
 */

import { AISLES, formatPaise } from '@mandi/design-system';

interface TickerItem {
  name: string;
  unit: string;
  paise: number;
  swatch: string;
  aisle: string;
}

function collect(offset: number): TickerItem[] {
  const out: TickerItem[] = [];
  AISLES.forEach((aisle) => {
    aisle.items.forEach((item, i) => {
      if (i % 2 === offset) {
        out.push({ ...item, swatch: aisle.swatch, aisle: aisle.name });
      }
    });
  });
  return out;
}

function Row({ items, reverse }: { items: TickerItem[]; reverse?: boolean }) {
  // The list is rendered twice so the translate can loop seamlessly at -50%.
  const doubled = [...items, ...items];

  return (
    <div className="ticker__row" data-reverse={reverse ? 'true' : 'false'}>
      <ul className="ticker__track">
        {doubled.map((item, i) => (
          <li className="ticker__item" key={`${item.name}-${i}`}>
            <span
              className="ticker__dot"
              style={{ background: item.swatch }}
              aria-hidden="true"
            />
            <span className="ticker__name">{item.name}</span>
            <span className="ticker__unit mono">{item.unit}</span>
            <span className="ticker__price price">{formatPaise(item.paise)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProduceTicker() {
  return (
    <section className="ticker bleed" aria-hidden="true">
      <Row items={collect(0)} />
      <Row items={collect(1)} reverse />
    </section>
  );
}
