'use client';

/**
 * PILLAR 1, made interactive — and made three-dimensional.
 *
 * Eight cards, one per aisle, each wrapped in its own <Tilt3D>: hover or
 * focus a card and it tilts toward the pointer while its label — the glyph,
 * the name, the Hindi, the item count — sits in a <Depth depth={4}> layer
 * nearer the viewer than the card face, so the label visibly parallaxes
 * against the card as it tilts instead of rotating as one flat plane.
 *
 * The tilt itself lives on an inner <button>, not on Tilt3D's own host tag:
 * Tilt3D's prop surface is deliberately narrow (no aria-pressed, no native
 * button semantics) so the real, accessible toggle button is nested inside
 * it and Tilt3D only ever supplies the perspective + rotation.
 *
 * Selecting a card expands the detail panel below with real stock at real
 * prices — remounted per aisle (`key={current.key}`) so it flips into view
 * with `tkr-flip-in` rather than static-swapping, which is the one flip in
 * this design that actually earns its place: it is the moment the page
 * proves the aisle mechanic on real data, not a colour chip.
 *
 * This section is also where the top bar's "Shop by aisle" menu lands.
 */

import { useState } from 'react';
import { AISLES, formatPaise, useAisle, Tilt3D, Depth } from '@mandi/design-system';
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
        <header className="mk-sec__head tkr-reveal">
          <p className="mk-eyebrow">Pillar one</p>
          <h2 className="mk-title">
            Nine aisles. Nine colours.
            <br />
            <em>One market.</em>
          </h2>
          <p className="mk-lede">
            Every category owns a hue taken from the produce itself. Walking into an
            aisle re-tints the accent, the rules, the buttons and the basket — so the
            app tells you where you are before you read a single word. Try one.
          </p>
        </header>

        <ul className="mk-grid mk-grid--aisles tkr-reveal-kids">
          {AISLES.map((a, i) => {
            const isOn = current?.key === a.key;
            return (
              <li
                className="mk-cell mk-cell--3"
                key={a.key}
                onMouseEnter={() => enter(a.key)}
                onFocus={() => enter(a.key)}
                onMouseLeave={leave}
                onBlur={leave}
              >
                <Tilt3D as="div" max={10} lift={14} glow className="mk-aisle-wrap">
                  <button
                    type="button"
                    className={['mk-aisle', 'tkr-card', isOn ? 'mk-aisle--on' : '']
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      ['--i' as string]: i,
                      ['--sw' as string]: `var(--aisle-${a.key})`,
                    }}
                    aria-pressed={isOn}
                    onClick={() => {
                      setHovered(null);
                      setSelected(a.key);
                      setAisle(a.key);
                    }}
                  >
                    <Depth depth={4} className="mk-aisle__face">
                      <AisleGlyph aisleKey={a.key} className="mk-aisle__glyph" />
                      <span className="mk-aisle__name">{a.name}</span>
                      <span className="mk-aisle__hi">{a.hindi}</span>
                      <span className="mk-aisle__count">{a.items.length} items shown</span>
                    </Depth>
                  </button>
                </Tilt3D>
              </li>
            );
          })}

          {current ? (
            <li className="mk-cell mk-cell--12" key={current.key}>
              <div className="mk-detail tkr-card tkr-card--raised">
                <div className="mk-detail__title">
                  {current.name}
                  <span className="mk-detail__hi">{current.hindi}</span>
                </div>
                <p className="mk-lede">{current.blurb}</p>

                <div className="tkr-scroll-x">
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
              </div>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
