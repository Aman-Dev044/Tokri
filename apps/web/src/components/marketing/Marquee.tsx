/**
 * The running strip above the header.
 *
 * Two promises a grocery is judged on before anything else — what delivery
 * costs and how fresh the food is — put where they cannot be missed.
 *
 * ── Why the list is duplicated in the markup ────────────────────────────
 * A marquee that translates by -50% needs TWO identical halves, or the
 * strip runs out and snaps back to a visible gap. The copy is rendered
 * twice and the second copy is `aria-hidden`, so a screen reader reads the
 * sentence once rather than stuttering it.
 *
 * ── Why it is paused for reduced motion ────────────────────────────────
 * Perpetual horizontal movement at the top of the viewport is exactly the
 * kind of thing that makes a vestibular disorder unusable, and this one
 * never stops. `prefers-reduced-motion` freezes it; the text is still
 * entirely readable standing still, so nothing is lost.
 */

const ITEMS: readonly string[] = [
  'Free delivery over ₹499',
  'Picked by a real shop near you',
  'Handover in about 22 minutes',
  'Cash on delivery up to ₹2,000',
];

function Run({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="mk-marquee__run" aria-hidden={hidden || undefined}>
      {ITEMS.map((item) => (
        <span className="mk-marquee__item" key={item}>
          {item}
          <span className="mk-marquee__sep" aria-hidden="true">
            ✦
          </span>
        </span>
      ))}
    </div>
  );
}

export function Marquee() {
  return (
    <div className="mk-marquee">
      <div className="mk-marquee__track">
        <Run />
        <Run hidden />
      </div>
    </div>
  );
}
