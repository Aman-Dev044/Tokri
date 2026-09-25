'use client';

/**
 * The illustrated half of the auth split.
 *
 * Eight crates on a market shelf, one per aisle, each in its own hue. They lift
 * and settle on a long, slow, staggered loop - the same "produce has weight"
 * idea as the GroceryLoader, at a scale you can sit next to while typing a
 * password. The crate whose aisle is currently live sits forward and carries
 * the label.
 *
 * All CSS keyframes; `prefers-reduced-motion` freezes it into a still life
 * (see auth.css). Purely decorative, so the whole thing is aria-hidden and the
 * quote beside it carries any meaning.
 */

import { AISLES, useAisle } from '@mandi/design-system';

export function AuthPanel({ kicker, line }: { kicker: string; line: string }) {
  const { aisle, preview, clearPreview } = useAisle();
  const activeKey = aisle ?? AISLES[0]?.key;

  return (
    <aside className="authpanel" aria-label="About Mandi">
      <div className="authpanel__wash" aria-hidden="true" />

      <div className="authpanel__shelf" aria-hidden="true" onMouseLeave={clearPreview}>
        {AISLES.map((a, i) => (
          <span
            key={a.key}
            className="crate"
            data-on={a.key === activeKey}
            style={{
              ['--w' as string]: a.swatch,
              ['--i' as string]: String(i),
            }}
            onMouseEnter={() => preview(a.key)}
          >
            <span className="crate__slats" />
            <span className="crate__heap" />
            <span className="crate__label mono">{a.name}</span>
          </span>
        ))}
        <span className="authpanel__plank" />
      </div>

      <blockquote className="authpanel__quote">
        <p className="eyebrow authpanel__kicker">{kicker}</p>
        <p className="authpanel__line">{line}</p>
      </blockquote>
    </aside>
  );
}
