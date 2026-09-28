'use client';

/**
 * The illustrated half of the auth split.
 *
 * Eight crates on a market shelf, one per aisle, each in its own hue,
 * mounted on a <Tilt3D> rig: the whole shelf tilts toward the pointer and
 * each crate sits at its own depth (`<Depth>`), so the shelf reads as a real
 * plane in space rather than a flat strip of colour. The crate whose aisle
 * is currently live lifts to the nearest depth and carries the label.
 *
 * All CSS keyframes and transform; `prefers-reduced-motion` freezes the
 * float and flattens the tilt (see auth.css / Tilt3D). Purely decorative, so
 * the whole shelf is aria-hidden and the quote beside it carries any
 * meaning.
 */

import { AISLES, useAisle, Tilt3D, Depth } from '@mandi/design-system';
import { APP_NAME } from '@/config/brand';

export function AuthPanel({ kicker, line }: { kicker: string; line: string }) {
  const { aisle, preview, clearPreview } = useAisle();
  const activeKey = aisle ?? AISLES[0]?.key;

  return (
    <aside className="authpanel" aria-label={`About ${APP_NAME}`}>
      <div className="authpanel__wash" aria-hidden="true" />

      <div aria-hidden="true">
        <Tilt3D as="div" max={7} lift={0} scale={1} className="authpanel__rig">
          <div className="authpanel__shelf" onMouseLeave={clearPreview}>
            {AISLES.map((a, i) => {
              const on = a.key === activeKey;
              return (
                <Depth
                  depth={on ? 4 : 2}
                  key={a.key}
                  className="crate"
                  style={{
                    ['--w' as string]: `var(--aisle-${a.key})`,
                    ['--i' as string]: String(i),
                  }}
                >
                  <span
                    className="crate__body"
                    data-on={on}
                    onMouseEnter={() => preview(a.key)}
                  >
                    <span className="crate__slats" />
                    <span className="crate__heap" />
                    <span className="crate__label">{a.name}</span>
                  </span>
                </Depth>
              );
            })}
            <span className="authpanel__plank" />
          </div>
        </Tilt3D>
      </div>

      <blockquote className="authpanel__quote">
        <p className="auth-eyebrow authpanel__kicker">{kicker}</p>
        <p className="authpanel__line">{line}</p>
      </blockquote>
    </aside>
  );
}
