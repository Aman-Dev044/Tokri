'use client';

/**
 * THE HERO — the page is the demo.
 *
 * The aisle picker on the right is a live control, not a picture of one:
 * hovering a swatch previews that hue across the entire page, clicking commits
 * it, and every accent — buttons, rules, washes, the progress hairline, the
 * footer strip — crossfades over --t-enter because --aisle is registered with
 * @property and --accent is re-pointed at it in marketing.css.
 *
 * Motion here is all load-time CSS. The headline words rise in sequence from a
 * `backwards` fill, the bento cells spring in on the shared --stagger cascade,
 * and the figures count up once on mount from a value that is already correct
 * in the server-rendered HTML. Nothing waits on a scroll observer, so the hero
 * is complete in a crawl, a link preview and a screenshot.
 *
 * It is sized to its content. A 100vh hero pushes the rest of the page out of
 * the first frame and tells a first-time visitor nothing about what follows.
 */

import { useState, type CSSProperties } from 'react';
import { AISLES, BentoCard, BentoGrid, formatPaise, useAisle } from '@mandi/design-system';
import type { AisleKey } from '@mandi/design-system';

import { AisleGlyph } from '@/components/marketing/AisleGlyph';
import { CountUp } from '@/components/marketing/CountUp';
import { MagneticLink } from '@/components/marketing/MagneticLink';

/* The headline, as words, so each can rise on its own delay. Splitting on a
   space at render time would break the non-breaking pairs below. */
const TITLE: ReadonlyArray<{ text: string; accent?: boolean }> = [
  { text: 'A' },
  { text: 'market' },
  { text: 'that' },
  { text: 'changes', accent: true },
  { text: 'colour', accent: true },
  { text: 'as' },
  { text: 'you' },
  { text: 'walk' },
  { text: 'through' },
  { text: 'it.' },
];

/* Three real lines off the real catalogue. Looked up by name rather than
   retyped, so a price change in the design system's aisle data reaches the
   landing page instead of quietly disagreeing with it. */
const COUNTER: ReadonlyArray<{ aisle: AisleKey; item: string }> = [
  { aisle: 'fruits', item: 'Alphonso Mango' },
  { aisle: 'dairy', item: 'Amul Taaza Milk' },
  { aisle: 'snacks', item: 'Bhavnagari Gathiya' },
];

interface CounterLine {
  aisle: AisleKey;
  aisleName: string;
  name: string;
  unit: string;
  paise: number;
}

function counterLines(): CounterLine[] {
  const out: CounterLine[] = [];
  for (const wanted of COUNTER) {
    const aisle = AISLES.find((a) => a.key === wanted.aisle);
    const item = aisle?.items.find((i) => i.name === wanted.item);
    if (aisle && item) {
      out.push({
        aisle: aisle.key,
        aisleName: aisle.name,
        name: item.name,
        unit: item.unit,
        paise: item.paise,
      });
    }
  }
  return out;
}

function swatchVar(key: AisleKey): CSSProperties {
  return { ['--sw' as string]: `var(--aisle-${key})` };
}

export function Hero() {
  const { aisle, setAisle, preview, clearPreview } = useAisle();
  const [locked, setLocked] = useState(false);
  const [hovered, setHovered] = useState<AisleKey | null>(null);

  const shownKey = hovered ?? aisle;
  const shown = AISLES.find((a) => a.key === shownKey) ?? AISLES[0];
  const lines = counterLines();

  return (
    <section className="mk-hero" id="top">
      <div className="mk-orbs" aria-hidden="true">
        <span className="mk-orb mk-orb--a" />
        <span className="mk-orb mk-orb--b" />
      </div>

      <div className="mk-shell">
        <BentoGrid>
          {/* ── the pitch ───────────────────────────────────────────────── */}
          <BentoCard span="wide" index={0} className="mk-hero__copy">
            <p className="mk-eyebrow">मंडी · multi-vendor grocery, India</p>

            <h1 className="mk-hero__title">
              {TITLE.map((word, i) => (
                <span
                  key={`${word.text}-${i}`}
                  className={word.accent ? 'mk-word mk-word--accent' : 'mk-word'}
                  style={{ ['--w' as string]: i }}
                >
                  {word.text}
                  {i < TITLE.length - 1 ? ' ' : null}
                </span>
              ))}
            </h1>

            <p className="mk-lede">
              Mandi is not a warehouse with a catalogue stapled on. It is the kirana, the
              dairy and the bakery already on your street — and every aisle you enter
              re-tints the whole app, so you always know where you are standing.
            </p>

            <div className="mk-hero__cta">
              <MagneticLink href="/signup" variant="solid">
                Start shopping
              </MagneticLink>
              <MagneticLink href="/#how-it-works" variant="quiet">
                See how it works
              </MagneticLink>
            </div>

            <p className="mk-hero__note">
              <span className="mk-live-dot" aria-hidden="true" />
              {locked
                ? `Locked to ${shown?.name ?? 'an aisle'} — pick another any time.`
                : 'Hover an aisle on the right. The page follows you into it.'}
            </p>
          </BentoCard>

          {/* ── the live aisle picker ───────────────────────────────────── */}
          <BentoCard span="third" index={1}>
            <div className="mk-picker">
              <p className="mk-eyebrow">{locked ? 'Your aisle' : 'Now tinting'}</p>

              <ul className="mk-picker__grid" onMouseLeave={() => {
                setHovered(null);
                clearPreview();
              }}>
                {AISLES.map((a) => {
                  const on = shown?.key === a.key;
                  return (
                    <li key={a.key}>
                      <button
                        type="button"
                        className="mk-pick"
                        style={swatchVar(a.key)}
                        data-on={on}
                        aria-pressed={on}
                        onMouseEnter={() => {
                          setHovered(a.key);
                          preview(a.key);
                        }}
                        onFocus={() => {
                          setHovered(a.key);
                          preview(a.key);
                        }}
                        onBlur={() => {
                          setHovered(null);
                          clearPreview();
                        }}
                        onClick={() => {
                          setHovered(null);
                          setLocked(true);
                          setAisle(a.key);
                        }}
                      >
                        <span className="mk-pick__dot" aria-hidden="true" />
                        <span className="mk-pick__name">{a.name}</span>
                        <span className="mk-pick__hi" aria-hidden="true">
                          {a.hindi}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {shown ? (
                <p className="mk-picker__blurb">
                  <span className="mk-picker__src">hue from {shown.source}</span>
                  {shown.blurb}
                </p>
              ) : null}
            </div>
          </BentoCard>

          {/* ── the numbers ─────────────────────────────────────────────── */}
          <BentoCard span="quarter" index={2} tone="pop-2">
            <div className="mk-stat">
              <span className="mk-stat__value">
                <CountUp to={AISLES.length} format={(n) => String(Math.round(n)).padStart(2, '0')} />
              </span>
              <span className="mk-stat__label">Chromatic aisles</span>
            </div>
          </BentoCard>

          <BentoCard span="quarter" index={3} tone="pop-1">
            <div className="mk-stat">
              <span className="mk-stat__value">
                <CountUp to={22} />
                <span className="mk-stat__unit">min</span>
              </span>
              <span className="mk-stat__label">Typical handover</span>
            </div>
          </BentoCard>

          <BentoCard span="quarter" index={4} tone="pop-3">
            <div className="mk-stat">
              <span className="mk-stat__value">
                <CountUp to={5} />
                <span className="mk-stat__unit">km</span>
              </span>
              <span className="mk-stat__label">Serviceable radius</span>
            </div>
          </BentoCard>

          <BentoCard span="quarter" index={5} tone="pop-4">
            <div className="mk-stat">
              <span className="mk-stat__value">
                <CountUp to={49900} format={(n) => formatPaise(Math.round(n))} />
              </span>
              <span className="mk-stat__label">Free delivery over</span>
            </div>
          </BentoCard>

          {/* ── three real lines off the counter ────────────────────────── */}
          {lines.map((line, i) => (
            <BentoCard span="third" index={6 + i} key={line.name}>
              <div className="mk-feature" style={swatchVar(line.aisle)}>
                <div className="mk-feature__art" style={{ color: `var(--aisle-${line.aisle}-ink)` }}>
                  <AisleGlyph aisleKey={line.aisle} />
                </div>
                <div className="mk-feature__row">
                  <span className="mk-feature__name">{line.name}</span>
                  <span className="mk-feature__price">
                    <CountUp to={line.paise} format={(n) => formatPaise(Math.round(n))} />
                  </span>
                </div>
                <div className="mk-feature__row">
                  <span className="mk-feature__unit">{line.unit}</span>
                  <span className="mk-feature__unit">{line.aisleName}</span>
                </div>
              </div>
            </BentoCard>
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}
