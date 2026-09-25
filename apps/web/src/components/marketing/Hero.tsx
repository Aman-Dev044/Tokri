'use client';

/**
 * THE HERO.
 *
 * The one idea: the page itself is the demo. Every ~5 seconds the committed
 * aisle advances, `data-aisle` changes on <html>, and the entire interface -
 * this hero, the top bar, every button, every rule, the footer - crossfades to
 * the next produce hue over 480ms. Nobody else does this, and you see it in the
 * first five seconds without clicking anything.
 *
 * The aisle rail on the right is the manual control: hovering previews a hue,
 * clicking commits it and stops the cycle (a visitor who takes control keeps
 * it). Keyboard users get the same thing through focus.
 *
 * Everything here is readable at rest. The entrance motion is a load-time
 * animation, not a scroll observer - the hero is never parked at opacity 0.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AISLES, formatPaise, useAisle } from '@mandi/design-system';

const CYCLE_MS = 5000;

export function Hero() {
  const { aisle, setAisle, preview, clearPreview } = useAisle();
  const [index, setIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // Advance the aisle on a timer until the visitor takes over.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A hue change every 5s is a large, slow, whole-page colour shift, not a
    // flash - but a visitor who asked for less motion still gets a static page.
    if (reduced) {
      const first = AISLES[0];
      if (first) setAisle(first.key);
      return;
    }

    const id = window.setInterval(() => {
      if (lockedRef.current) return;
      setIndex((i) => (i + 1) % AISLES.length);
    }, CYCLE_MS);

    return () => window.clearInterval(id);
  }, [setAisle]);

  useEffect(() => {
    if (locked) return;
    const next = AISLES[index];
    if (next) setAisle(next.key);
  }, [index, locked, setAisle]);

  const activeKey = aisle ?? AISLES[0]?.key ?? 'vegetables';
  const active = AISLES.find((a) => a.key === activeKey) ?? AISLES[0];

  return (
    <section className="hero bleed" id="top">
      {/* the ambient wash - two soft fields of the live aisle hue */}
      <div className="hero__wash" aria-hidden="true" />
      <div className="hero__hairlines" aria-hidden="true" />

      <div className="hero__inner shell">
        <div className="hero__copy">
          <p className="eyebrow rise" style={{ ['--i' as string]: '0' }}>
            मंडी <span aria-hidden="true">·</span> multi-vendor grocery, India
          </p>

          <h1 className="hero__title rise" style={{ ['--i' as string]: '1' }}>
            A market that{' '}
            <span className="hero__title-accent">changes&nbsp;colour</span> as you walk
            through it.
          </h1>

          <p className="lede rise" style={{ ['--i' as string]: '2' }}>
            Mandi is not a warehouse with a catalogue stapled on. It is the kirana, the
            dairy and the bakery already on your street — and every aisle you enter
            re-tints the whole app, so you always know where you are standing.
          </p>

          <div className="hero__cta rise" style={{ ['--i' as string]: '3' }}>
            <Link href="/signup" className="mnd-btn mnd-btn--solid mnd-btn--lg">
              Start shopping
            </Link>
            <Link href="/#how-it-works" className="mnd-btn mnd-btn--outline mnd-btn--lg">
              See how it works
            </Link>
          </div>

          <dl className="hero__stats rise" style={{ ['--i' as string]: '4' }}>
            <div className="hero__stat">
              <dt>Aisles</dt>
              <dd className="mono">08</dd>
            </div>
            <div className="hero__stat">
              <dt>Typical handover</dt>
              <dd className="mono">22 min</dd>
            </div>
            <div className="hero__stat">
              <dt>Free delivery over</dt>
              <dd className="mono">{formatPaise(49900)}</dd>
            </div>
            <div className="hero__stat">
              <dt>Serviceable radius</dt>
              <dd className="mono">5 km</dd>
            </div>
          </dl>
        </div>

        {/* ── the aisle rail ─────────────────────────────────────────────── */}
        <div className="rail" onMouseLeave={clearPreview}>
          <p className="rail__head eyebrow">
            {locked ? 'Your aisle' : 'Now tinting'}
            <span className="rail__pulse" data-locked={locked} aria-hidden="true" />
          </p>

          <ul className="rail__list">
            {AISLES.map((a) => {
              const isActive = a.key === activeKey;
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    className="rail__item"
                    data-active={isActive}
                    aria-pressed={isActive}
                    onMouseEnter={() => preview(a.key)}
                    onFocus={() => preview(a.key)}
                    onBlur={clearPreview}
                    onClick={() => {
                      setLocked(true);
                      setAisle(a.key);
                    }}
                  >
                    <span
                      className="rail__swatch"
                      style={{ background: a.swatch }}
                      aria-hidden="true"
                    />
                    <span className="rail__name">{a.name}</span>
                    <span className="rail__hindi mono" aria-hidden="true">
                      {a.hindi}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {active ? (
            <p className="rail__blurb">
              <span className="rail__blurb-src mono">from {active.source}</span>
              {active.blurb}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
