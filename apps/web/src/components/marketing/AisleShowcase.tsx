'use client';

/**
 * PILLAR 1, made interactive.
 *
 * Eight bento cells, one per aisle. Hover or focus a cell and the whole page
 * previews that aisle's hue; click and it sticks. The selected cell expands the
 * detail panel below to show real stock at real prices, so the mechanic is
 * demonstrated on actual catalogue data rather than on a colour chip.
 *
 * This section is also where the top bar's "Shop by aisle" menu lands.
 */

import { useState } from 'react';
import { AISLES, BentoCard, BentoGrid, formatPaise, useAisle } from '@mandi/design-system';
import type { AisleKey } from '@mandi/design-system';

import { AisleGlyph } from '@/components/marketing/AisleGlyph';

export function AisleShowcase() {
  const { aisle, setAisle, preview, clearPreview } = useAisle();
  const [selected, setSelected] = useState<AisleKey>(AISLES[0]?.key ?? 'fruits');
  // `hovered` mirrors the provider's preview state locally, so the detail panel
  // below follows the hue the page is actually showing. Without it the panel
  // reads the committed aisle while the page tints to the hovered one.
  const [hovered, setHovered] = useState<AisleKey | null>(null);
  const current = AISLES.find((a) => a.key === (hovered ?? aisle ?? selected)) ?? AISLES[0];

  const enter = (key: AisleKey) => {
    setHovered(key);
    preview(key);
  };
  const leave = () => {
    setHovered(null);
    clearPreview();
  };

  return (
    <section className="mk-sec" id="aisles">
      <div className="mk-shell">
        <header className="mk-sec__head">
          <p className="mk-eyebrow">Pillar one</p>
          <h2 className="mk-title">
            Eight aisles. Eight colours.
            <br />
            <em>One market.</em>
          </h2>
          <p className="mk-lede">
            Every category owns a hue taken from the produce itself. Walking into an
            aisle re-tints the accent, the rules, the buttons and the basket — so the
            app tells you where you are before you read a single word. Try one.
          </p>
        </header>

        <BentoGrid>
          {AISLES.map((a, i) => {
            const isOn = current?.key === a.key;
            return (
              <button
                type="button"
                key={a.key}
                className={[
                  'mnd-cell',
                  'mnd-cell--quarter',
                  'mnd-cell--act',
                  'mk-aisle',
                  isOn ? 'mk-aisle--on' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  ['--i' as string]: i,
                  ['--sw' as string]: `var(--aisle-${a.key})`,
                }}
                aria-pressed={isOn}
                onMouseEnter={() => enter(a.key)}
                onFocus={() => enter(a.key)}
                onMouseLeave={leave}
                onBlur={leave}
                onClick={() => {
                  setHovered(null);
                  setSelected(a.key);
                  setAisle(a.key);
                }}
              >
                <AisleGlyph aisleKey={a.key} className="mk-aisle__glyph" />
                <span className="mk-aisle__name">{a.name}</span>
                <span className="mk-aisle__hi">{a.hindi}</span>
                <span className="mk-aisle__count">{a.items.length} items shown</span>
              </button>
            );
          })}

          {current ? (
            <BentoCard span="hero" index={8} className="mk-aisle-detail" key={current.key}>
              <div className="mk-detail__title">
                {current.name}
                <span className="mk-detail__hi">{current.hindi}</span>
              </div>
              <p className="mk-lede">{current.blurb}</p>

              <div className="mnd-cell__scroll">
                <ul className="mk-stock">
                  {current.items.map((item, i) => (
                    <li
                      className="mk-stock__item"
                      key={item.name}
                      style={{ ['--i' as string]: String(i) }}
                    >
                      <span className="mk-stock__name">{item.name}</span>
                      <span className="mk-stock__unit">{item.unit}</span>
                      <span className="mk-stock__price">{formatPaise(item.paise)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </BentoCard>
          ) : null}
        </BentoGrid>
      </div>
    </section>
  );
}
