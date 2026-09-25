'use client';

/**
 * PILLAR 1, made interactive.
 *
 * Eight panels, one per aisle. Hover or focus a panel and the whole page
 * previews that aisle's hue; click and it sticks. The selected panel expands to
 * show real stock at real prices, so the mechanic is demonstrated on actual
 * catalogue data rather than on a colour chip.
 *
 * This section is also where the top bar's "Shop by aisle" menu lands.
 */

import { useState, type ReactNode } from 'react';
import { AISLES, formatPaise, useAisle } from '@mandi/design-system';
import type { AisleKey } from '@mandi/design-system';

function AisleGlyph({ aisleKey }: { aisleKey: AisleKey }) {
  // A one-line produce mark per aisle. Drawn, not an emoji - emoji section
  // markers are the generic-AI-design tell we are deliberately avoiding.
  const paths: Record<AisleKey, ReactNode> = {
    fruits: (
      <>
        <circle cx="16" cy="19" r="9" />
        <path d="M16 10 q3 -5 8 -5" />
      </>
    ),
    vegetables: (
      <>
        <path d="M16 28 Q6 18 16 5 Q26 18 16 28 Z" />
        <path d="M16 24 V9" />
      </>
    ),
    dairy: (
      <>
        <path d="M11 12 h10 v16 h-10 z" />
        <path d="M11 12 l5 -7 l5 7" />
      </>
    ),
    bakery: (
      <>
        <path d="M5 21 q11 -14 22 0 q-11 7 -22 0 Z" />
        <path d="M12 16 l2 6 M19 15 l2 7" />
      </>
    ),
    beverages: (
      <>
        <path d="M13 6 h6 v4 l3 6 v12 h-12 v-12 l3 -6 z" />
        <path d="M10 20 h12" />
      </>
    ),
    snacks: (
      <>
        <path d="M9 9 l14 14 M23 9 l-14 14" />
        <circle cx="16" cy="16" r="10" />
      </>
    ),
    staples: (
      <>
        <path d="M16 5 v22" />
        <path d="M16 11 q6 -1 7 -6 M16 11 q-6 -1 -7 -6" />
        <path d="M16 19 q6 -1 7 -6 M16 19 q-6 -1 -7 -6" />
      </>
    ),
    frozen: (
      <>
        <path d="M16 4 v24 M6 10 l20 12 M26 10 L6 22" />
        <path d="M13 7 l3 3 l3 -3 M13 25 l3 -3 l3 3" />
      </>
    ),
  };

  return (
    <svg
      className="aisle-card__glyph"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[aisleKey]}
    </svg>
  );
}

export function AisleShowcase() {
  const { aisle, setAisle, preview, clearPreview } = useAisle();
  const [selected, setSelected] = useState<AisleKey>(AISLES[0]?.key ?? 'fruits');
  // `hovered` mirrors the provider's preview state locally, so the stock list
  // below follows the hue the page is actually showing. Without it the page
  // tints to the hovered aisle while the panel still reads the committed one.
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
    <section className="showcase bleed" id="aisles">
      <div className="shell">
        <header className="section-head">
          <p className="eyebrow">Pillar one</p>
          <h2 className="section-title">
            Eight aisles.
            <br />
            Eight colours.
            <br />
            <span className="section-title-accent">One market.</span>
          </h2>
          <p className="lede">
            Every category owns a hue taken from the produce itself. Walking into an
            aisle re-tints the accent, the rules, the buttons and the basket — so the
            app tells you where you are before you read a single word. Try one.
          </p>
        </header>

        <div className="showcase__grid" onMouseLeave={leave}>
          {AISLES.map((a) => {
            const isOn = current?.key === a.key;
            return (
              <button
                type="button"
                key={a.key}
                className="aisle-card"
                data-on={isOn}
                aria-pressed={isOn}
                onMouseEnter={() => enter(a.key)}
                onFocus={() => enter(a.key)}
                onBlur={leave}
                onClick={() => {
                  setHovered(null);
                  setSelected(a.key);
                  setAisle(a.key);
                }}
              >
                <span
                  className="aisle-card__band"
                  style={{ background: a.swatch }}
                  aria-hidden="true"
                />
                <AisleGlyph aisleKey={a.key} />
                <span className="aisle-card__name">{a.name}</span>
                <span className="aisle-card__hindi mono">{a.hindi}</span>
                <span className="aisle-card__hex mono" aria-hidden="true">
                  {a.swatch}
                </span>
              </button>
            );
          })}
        </div>

        {current ? (
          <div className="showcase__detail" key={current.key}>
            <div className="showcase__detail-head">
              <h3 className="showcase__detail-title">
                {current.name}
                <span className="showcase__detail-hi mono">{current.hindi}</span>
              </h3>
              <p className="showcase__detail-blurb">{current.blurb}</p>
            </div>

            <div className="scroll-x">
              <ul className="stock">
                {current.items.map((item) => (
                  <li className="stock__item" key={item.name}>
                    <span className="stock__name">{item.name}</span>
                    <span className="stock__unit mono">{item.unit}</span>
                    <span className="stock__price price">{formatPaise(item.paise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
