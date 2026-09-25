'use client';

/**
 * PILLAR 4 — THE JOURNEY RIBBON ★ this replaces the map.
 *
 * Tracking is the emotional peak of a delivery app and every competitor wastes
 * it on a grey map with a scooter crawling across it. Mandi's tracking screen
 * is a vertical ribbon running down the page: a stylised route from the store
 * to your door that FILLS with the aisle colour as the order progresses, and
 * each milestone lands as a STAMP with a press animation — a real delivery
 * receipt being franked.
 *
 * The map is secondary, desaturated and collapsible, and it lives BELOW this.
 * Nothing here depends on it: with no Maps key at all, this screen is complete.
 *
 * ── DESIGN NOTES ────────────────────────────────────────────────────────────
 * · The fill is `var(--aisle)`, so a fruits order tracks in tomato and a dairy
 *   order tracks in butter. Text on the ribbon uses `var(--aisle-ink)`, which
 *   is the contrast-tuned variant — never `--aisle` for small type (plan §2.6).
 * · The stamp press is the only spring in the component, and it fires ONCE per
 *   milestone, at the moment it lands. A ribbon that bounces on every render
 *   is decoration; a ribbon that bounces when your order is picked up is
 *   information.
 * · Colour never carries meaning alone: every state has a glyph and a word.
 * · Under `prefers-reduced-motion: reduce` the fill jumps and the stamps do not
 *   press. The screen is completely readable at rest.
 *
 * ── STYLING ─────────────────────────────────────────────────────────────────
 * Self-contained: the CSS ships with the component as a React 19 hoisted
 * <style href>, so importing it requires no stylesheet wiring and mounting two
 * of them contributes one set of rules.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ───────────────────────────────── types ────────────────────────────────── */

export type JourneyState = 'done' | 'current' | 'pending' | 'failed';

export interface JourneyMilestone {
  /** stable id — used to detect the moment a stamp lands */
  key: string;
  /** the headline, e.g. "Picked up" */
  label: string;
  /** one line of plain English under the label */
  caption?: string;
  /** ISO timestamp, rendered in mono when present */
  at?: string | null;
  state: JourneyState;
}

export interface JourneyRibbonProps {
  milestones: readonly JourneyMilestone[];
  /**
   * 0…1. How far the ribbon has filled. Omit and it is derived from the
   * milestone states (every `done` counts, `current` counts as a half step) —
   * which is right for almost every caller.
   */
  progress?: number;
  /** e.g. "MND-20260925-0007" — set in mono at the head of the ribbon */
  orderNo?: string;
  /** the one number that matters, e.g. "18 min" */
  eta?: string;
  /** small label above the ETA, e.g. "Arriving in" */
  etaLabel?: string;
  /** connection banner, stale-location notice — anything the caller owns */
  footer?: ReactNode;
  /** terminal unhappy path: the ribbon greys out and the fill stops */
  cancelled?: boolean;
  className?: string;
}

/* ─────────────────────────────── helpers ────────────────────────────────── */

function deriveProgress(milestones: readonly JourneyMilestone[]): number {
  if (milestones.length === 0) return 0;
  let score = 0;
  for (const m of milestones) {
    if (m.state === 'done') score += 1;
    else if (m.state === 'current') score += 0.5;
  }
  return Math.max(0, Math.min(1, score / milestones.length));
}

function formatStamp(at: string | null | undefined): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/* ────────────────────────────── the glyphs ──────────────────────────────── */

function StateGlyph({ state }: { state: JourneyState }) {
  if (state === 'done') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 12.6 L10.2 16.8 L18 8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'failed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8 8 L16 16 M16 8 L8 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (state === 'current') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.4" fill="currentColor" />
        <circle
          cx="12"
          cy="12"
          r="8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          opacity="0.55"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

const STATE_WORD: Record<JourneyState, string> = {
  done: 'Done',
  current: 'Now',
  pending: 'To come',
  failed: 'Failed',
};

/* ──────────────────────────── the component ─────────────────────────────── */

export function JourneyRibbon({
  milestones,
  progress,
  orderNo,
  eta,
  etaLabel = 'Arriving in',
  footer,
  cancelled = false,
  className,
}: JourneyRibbonProps) {
  const fill = cancelled ? 0 : (progress ?? deriveProgress(milestones));

  /* The franking press: fires once, on the render where a stamp lands. */
  const previous = useRef<Map<string, JourneyState>>(new Map());
  const [struck, setStruck] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const landed: string[] = [];
    for (const m of milestones) {
      const before = previous.current.get(m.key);
      const isLanded = m.state === 'done' || m.state === 'current' || m.state === 'failed';
      const wasLanded = before === 'done' || before === 'current' || before === 'failed';
      // `before === undefined` is the first render: do NOT press every stamp
      // on mount, or the whole history animates at someone who just opened the
      // page on an order placed two hours ago.
      if (before !== undefined && isLanded && !wasLanded) landed.push(m.key);
      previous.current.set(m.key, m.state);
    }
    if (landed.length === 0) return;

    setStruck(new Set(landed));
    const timer = window.setTimeout(() => {
      setStruck(new Set());
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [milestones]);

  const currentIndex = milestones.findIndex((m) => m.state === 'current');
  const headline =
    currentIndex >= 0
      ? milestones[currentIndex]?.label
      : (milestones[milestones.length - 1]?.label ?? 'Order');

  return (
    <section
      className={['mnd-ribbon', className].filter(Boolean).join(' ')}
      data-cancelled={cancelled ? 'true' : undefined}
      aria-label="Order journey"
    >
      <RibbonStyles />

      <header className="mnd-ribbon__head">
        <div>
          {orderNo ? <p className="mnd-ribbon__orderno">{orderNo}</p> : null}
          <h2 className="mnd-ribbon__headline">{cancelled ? 'Cancelled' : headline}</h2>
        </div>
        {eta && !cancelled ? (
          <div className="mnd-ribbon__eta">
            <span className="mnd-ribbon__eta-label">{etaLabel}</span>
            <strong className="mnd-ribbon__eta-value">{eta}</strong>
          </div>
        ) : null}
      </header>

      <div className="mnd-ribbon__body">
        {/* The ribbon itself. aria-hidden because the <ol> beside it already
            carries the whole story in text. */}
        <div className="mnd-ribbon__track" aria-hidden="true">
          <div className="mnd-ribbon__rail" />
          <div
            className="mnd-ribbon__fill"
            style={{ ['--mnd-ribbon-fill' as string]: `${(fill * 100).toFixed(2)}%` }}
          />
        </div>

        <ol className="mnd-ribbon__list">
          {milestones.map((m) => {
            const time = formatStamp(m.at);
            return (
              <li
                key={m.key}
                className="mnd-ribbon__item"
                data-state={m.state}
                data-strike={struck.has(m.key) ? 'true' : undefined}
                aria-current={m.state === 'current' ? 'step' : undefined}
              >
                <span className="mnd-ribbon__stamp">
                  <StateGlyph state={m.state} />
                </span>
                <div className="mnd-ribbon__text">
                  <p className="mnd-ribbon__label">
                    {m.label}
                    <span className="mnd-ribbon__state-word">{STATE_WORD[m.state]}</span>
                  </p>
                  {m.caption ? <p className="mnd-ribbon__caption">{m.caption}</p> : null}
                </div>
                {time ? (
                  <time className="mnd-ribbon__time" dateTime={m.at ?? undefined}>
                    {time}
                  </time>
                ) : (
                  <span className="mnd-ribbon__time mnd-ribbon__time--empty" aria-hidden="true">
                    ··:··
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {footer ? <footer className="mnd-ribbon__foot">{footer}</footer> : null}
    </section>
  );
}

/* ─────────────────────────────── styles ─────────────────────────────────── */

const RIBBON_CSS = `
.mnd-ribbon {
  --mnd-ribbon-w: 52px;
  display: grid;
  gap: var(--s-4);
  padding: var(--s-5) var(--s-4) var(--s-4);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-panel);
  box-shadow: var(--lift-1);
}
@media (min-width: 640px) {
  .mnd-ribbon { --mnd-ribbon-w: 64px; padding: var(--s-6) var(--s-5) var(--s-5); }
}

.mnd-ribbon__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--s-3);
  padding-bottom: var(--s-4);
  border-bottom: 1px solid var(--hairline);
}
.mnd-ribbon__orderno {
  font-family: var(--data);
  font-size: var(--fs-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.mnd-ribbon__headline {
  font-family: var(--display);
  font-size: var(--fs-h2);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--aisle-ink);
}
.mnd-ribbon[data-cancelled='true'] .mnd-ribbon__headline { color: var(--crit-ink); }
.mnd-ribbon__eta { text-align: right; }
.mnd-ribbon__eta-label {
  display: block;
  font-size: var(--fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted);
}
.mnd-ribbon__eta-value {
  font-family: var(--data);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-h3);
  font-weight: 500;
  letter-spacing: -0.02em;
}

.mnd-ribbon__body { position: relative; }

/* ── the ribbon ─────────────────────────────────────────────────────────── */
.mnd-ribbon__track {
  position: absolute;
  top: 1.25rem;
  bottom: 1.25rem;
  left: calc(var(--mnd-ribbon-w) / 2);
  width: 14px;
  translate: -50% 0;
  pointer-events: none;
}
.mnd-ribbon__rail {
  position: absolute;
  inset: 0;
  border-radius: var(--r-pill);
  background: var(--sunken);
  border: 1px solid var(--hairline);
}
.mnd-ribbon__fill {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--mnd-ribbon-fill, 0%);
  border-radius: var(--r-pill);
  background:
    repeating-linear-gradient(
      -45deg,
      color-mix(in srgb, var(--aisle-on) 16%, transparent) 0 6px,
      transparent 6px 12px
    ),
    var(--aisle);
  box-shadow: 0 0 0 1px var(--aisle-edge), 0 6px 18px -10px var(--aisle-glow);
  transition: height 900ms var(--ease-out);
}
.mnd-ribbon[data-cancelled='true'] .mnd-ribbon__fill { background: var(--hairline-strong); }

/* ── the stamps ─────────────────────────────────────────────────────────── */
.mnd-ribbon__list {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--s-5);
}
.mnd-ribbon__item {
  display: grid;
  grid-template-columns: var(--mnd-ribbon-w) 1fr auto;
  align-items: start;
  gap: var(--s-2);
  min-height: 2.5rem;
}
.mnd-ribbon__stamp {
  justify-self: center;
  position: relative;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--r-soft);
  border: 2px solid var(--hairline-strong);
  background: var(--surface-2);
  color: var(--muted);
  /* a franked stamp sits slightly off-square */
  rotate: -3deg;
  transition:
    background-color var(--t-move) var(--ease),
    border-color var(--t-move) var(--ease),
    color var(--t-move) var(--ease);
}
.mnd-ribbon__stamp svg { width: 22px; height: 22px; }

.mnd-ribbon__item[data-state='done'] .mnd-ribbon__stamp,
.mnd-ribbon__item[data-state='current'] .mnd-ribbon__stamp {
  background: var(--aisle);
  border-color: var(--aisle);
  color: var(--aisle-on);
  box-shadow: 0 8px 22px -14px var(--aisle-glow);
}
.mnd-ribbon__item[data-state='current'] .mnd-ribbon__stamp {
  rotate: 2deg;
  outline: 2px solid var(--aisle-edge);
  outline-offset: 3px;
}
.mnd-ribbon__item[data-state='failed'] .mnd-ribbon__stamp {
  background: var(--crit);
  border-color: var(--crit);
  color: var(--on-semantic);
}
.mnd-ribbon__item[data-state='pending'] .mnd-ribbon__stamp {
  border-style: dashed;
  background: var(--paper);
}

/* the press — one signature moment, fired once, when the stamp lands */
@keyframes mnd-frank {
  0%   { scale: 1.55; rotate: -14deg; opacity: 0.25; }
  55%  { scale: 0.92; rotate: 3deg;  opacity: 1; }
  100% { scale: 1;    rotate: -3deg; opacity: 1; }
}
.mnd-ribbon__item[data-strike='true'] .mnd-ribbon__stamp {
  animation: mnd-frank 620ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.mnd-ribbon__text { padding-top: 0.35rem; min-width: 0; }
.mnd-ribbon__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--s-2);
  font-family: var(--display);
  font-weight: 600;
  font-size: var(--fs-h3);
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.mnd-ribbon__item[data-state='pending'] .mnd-ribbon__label { color: var(--muted); }
.mnd-ribbon__item[data-state='current'] .mnd-ribbon__label { color: var(--aisle-ink); }
.mnd-ribbon__item[data-state='failed'] .mnd-ribbon__label { color: var(--crit-ink); }

/* the word beside the colour — colour never carries meaning alone */
.mnd-ribbon__state-word {
  font-family: var(--data);
  font-size: var(--fs-micro);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  padding: 0.1rem 0.4rem;
  border-radius: var(--r-nub);
  border: 1px solid var(--hairline);
  color: var(--muted);
  background: var(--paper);
}
.mnd-ribbon__item[data-state='current'] .mnd-ribbon__state-word {
  border-color: var(--aisle-edge);
  color: var(--aisle-ink);
}
.mnd-ribbon__item[data-state='failed'] .mnd-ribbon__state-word {
  border-color: var(--crit-ink);
  color: var(--crit-ink);
}
.mnd-ribbon__caption {
  margin-top: 0.15rem;
  font-size: var(--fs-small);
  line-height: 1.5;
  color: var(--muted);
  text-wrap: pretty;
}
.mnd-ribbon__time {
  padding-top: 0.55rem;
  font-family: var(--data);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-small);
  color: var(--muted);
  white-space: nowrap;
}
.mnd-ribbon__time--empty { opacity: 0.4; }

.mnd-ribbon__foot {
  padding-top: var(--s-4);
  border-top: 1px solid var(--hairline);
}

@media (prefers-reduced-motion: reduce) {
  .mnd-ribbon__fill { transition: none; }
  .mnd-ribbon__item[data-strike='true'] .mnd-ribbon__stamp { animation: none; }
}
`;

function RibbonStyles() {
  return (
    <style href="mandi-journey-ribbon" precedence="default">
      {RIBBON_CSS}
    </style>
  );
}
