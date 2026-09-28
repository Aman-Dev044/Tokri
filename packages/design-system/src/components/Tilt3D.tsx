'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   TILT3D — the depth engine of "Neon Orchard".

   Tracks the pointer over an element and writes two custom properties,
   `--mx` and `--my`, in the range -50..50. CSS does the rest, so the
   transform is composited on the GPU and React never re-renders on
   pointer move.

   THREE THINGS THIS GETS RIGHT THAT A NAIVE TILT DOES NOT

   1. Perspective must live on an ANCESTOR, not on the tilting element.
      `transform: perspective(...) rotateY(...)` on the element itself
      gives every child the same vanishing point, so a "layer" at
      translateZ never parallaxes — it just scales. The wrapper here owns
      `perspective`; the inner stage owns `transform-style: preserve-3d`.

   2. The listener is on the WRAPPER, and the geometry is read once per
      frame from a cached rect. Reading `getBoundingClientRect()` inside
      the move handler forces layout on every mouse event, which is the
      usual reason a tilt feels heavy.

   3. It is inert for anyone who asked for less motion, and for anyone on
      a touch device. A tilt is a vestibular trigger, and on touch there
      is no hover state to tilt toward — the effect would only fire
      mid-tap and look like a glitch.
   ═══════════════════════════════════════════════════════════════════════ */

export interface Tilt3DProps {
  children: ReactNode;
  /** Degrees of rotation at the far edge. Past ~12 the text distorts. */
  max?: number;
  /** Lift toward the viewer while hovered, in px of translateZ. */
  lift?: number;
  /** Add the accent glow on hover. For cells that are the point of the page. */
  glow?: boolean;
  /** Scale on hover. 1 disables it. */
  scale?: number;
  className?: string;
  as?: ElementType;
  style?: CSSProperties;
  onClick?: () => void;
  'aria-label'?: string;
}

export function Tilt3D({
  children,
  max = 9,
  lift = 18,
  glow = false,
  scale = 1.015,
  className,
  as: Tag = 'div',
  style,
  onClick,
  ...rest
}: Tilt3DProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const frameRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Both conditions are real disqualifiers, not preferences:
    // a coarse pointer has no hover to track, and reduced-motion is an
    // accessibility setting, not a style option.
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setEnabled(fine.matches && !calm.matches);
    sync();
    fine.addEventListener('change', sync);
    calm.addEventListener('change', sync);
    return () => {
      fine.removeEventListener('change', sync);
      calm.removeEventListener('change', sync);
    };
  }, []);

  const write = useCallback((mx: number, my: number) => {
    const el = hostRef.current;
    if (!el) return;
    el.style.setProperty('--mx', mx.toFixed(2));
    el.style.setProperty('--my', my.toFixed(2));
  }, []);

  const onEnter = useCallback(() => {
    if (!enabled || !hostRef.current) return;
    // Cached once per hover. Reading it per move event forces a layout
    // on every single mousemove.
    rectRef.current = hostRef.current.getBoundingClientRect();
    hostRef.current.style.setProperty('--lift', `${lift}px`);
    hostRef.current.style.setProperty('--scale', String(scale));
  }, [enabled, lift, scale]);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      const r = rectRef.current;
      if (!r) return;
      const { clientX, clientY } = e;
      if (frameRef.current !== null) return; // coalesce to one write per frame
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const mx = ((clientX - r.left) / r.width - 0.5) * 100;
        const my = ((clientY - r.top) / r.height - 0.5) * 100;
        write(mx, my);
      });
    },
    [enabled, write],
  );

  const onLeave = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const el = hostRef.current;
    if (!el) return;
    // Back to rest. The CSS transition carries it, so it settles rather
    // than snapping.
    el.style.setProperty('--mx', '0');
    el.style.setProperty('--my', '0');
    el.style.setProperty('--lift', '0px');
    el.style.setProperty('--scale', '1');
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <Tag
      ref={hostRef}
      className={['tkr-tilt3d', glow ? 'tkr-tilt3d--glow' : '', className]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--tilt-max' as string]: `${max}deg`, ...style }}
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={onClick}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
      {...rest}
    >
      <span className="tkr-tilt3d__stage">{children}</span>
    </Tag>
  );
}

/**
 * A layer inside a Tilt3D that sits at a given depth.
 *
 * `depth` maps to the --z-* scale: 1 is barely off the surface, 4 floats
 * well in front of it. Layering is what turns a tilt into parallax —
 * without at least two depths the card is a rotating rectangle.
 */
export function Depth({
  children,
  depth = 2,
  className,
  style,
}: {
  children: ReactNode;
  depth?: 1 | 2 | 3 | 4;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={['tkr-depth', className].filter(Boolean).join(' ')}
      style={{ ['--z' as string]: `var(--z-${depth})`, ...style }}
    >
      {children}
    </span>
  );
}
