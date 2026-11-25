'use client';

import { useId, useMemo } from 'react';
import type { PillTone } from './primitives';

export type SparkTone = Extract<PillTone, 'good' | 'warn' | 'crit' | 'neutral'>;

export interface SparklineProps {
  /** oldest value first */
  data: number[];
  width?: number;
  height?: number;
  tone?: SparkTone;
  /** fill the area under the line — off by default; a KPI tile wants the line */
  area?: boolean;
  /** accessible summary; defaults to a sensible sentence */
  label?: string;
  className?: string;
}

const TONE_STROKE: Record<SparkTone, string> = {
  good: 'var(--good-ink)',
  warn: 'var(--warn-ink)',
  crit: 'var(--crit-ink)',
  neutral: 'var(--accent-ink)',
};

/**
 * A trend, at the size of a word.
 *
 * ── NO AXES, NO GRID, NO NUMBERS ────────────────────────────────────────────
 * A sparkline answers one question — is this going up or down, and how
 * steadily — and it answers it inside the reading flow of the tile it sits in.
 * The moment it grows a scale it is a chart, and it belongs in a panel.
 *
 * The line is normalised to its OWN min/max with a 12% margin, so a series that
 * wanders between 118 and 122 still shows its shape. That is the right choice
 * for a shape-reading mark and the wrong one for anything anybody measures off,
 * which is the other reason there are no numbers on it.
 *
 * ── THE DRAW-IN ─────────────────────────────────────────────────────────────
 * The path length is computed in JS from the point list rather than read back
 * with `getTotalLength()`: no layout read, no effect, and the value is stable
 * across the server render and the client render. It is handed to CSS as
 * `--adm-len`, and `.adm-draw` animates `stroke-dashoffset` from it to zero.
 * Under reduced motion the dash is cleared outright (see admin.css §16), which
 * is why the rendered `strokeDasharray` here is safe to leave in place.
 */
export function Sparkline({
  data,
  width = 92,
  height = 26,
  tone = 'neutral',
  area = false,
  label,
  className,
}: SparklineProps) {
  const uid = useId().replace(/:/g, '');

  const geometry = useMemo(() => {
    const points = data.filter((n) => Number.isFinite(n));
    if (points.length < 2) return null;

    const min = Math.min(...points);
    const max = Math.max(...points);
    const pad = (max - min) * 0.12 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const span = hi - lo || 1;

    const stepX = width / (points.length - 1);
    // 1px inset top and bottom so a round cap at an extreme is not clipped.
    const coords = points.map((value, i) => {
      const x = i * stepX;
      const y = height - 1 - ((value - lo) / span) * (height - 2);
      return [x, y] as const;
    });

    const d = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');

    let length = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      if (!a || !b) continue;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }

    const last = coords[coords.length - 1];
    const first = points[0] ?? 0;
    const final = points[points.length - 1] ?? 0;

    return {
      d,
      length: Math.ceil(length),
      last,
      rising: final >= first,
      areaD: `${d} L${width} ${height} L0 ${height} Z`,
    };
  }, [data, width, height]);

  if (!geometry) {
    // Fewer than two points is not a trend. Say so rather than drawing a dot
    // and letting someone read a flat line as "no change".
    return (
      <span className="adm-dim" style={{ fontSize: 'var(--adm-fs-xs)' }}>
        no trend yet
      </span>
    );
  }

  const stroke = TONE_STROKE[tone];
  const gradientId = `adm-spark-${uid}`;

  return (
    <svg
      className={['adm-spark', className].filter(Boolean).join(' ')}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        label ??
        `Trend over the last ${data.length} points, ${geometry.rising ? 'rising' : 'falling'}`
      }
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="adm-chart__area" d={geometry.areaD} fill={`url(#${gradientId})`} />
        </>
      ) : null}

      <path
        className="adm-spark__line adm-draw"
        d={geometry.d}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={geometry.length}
        style={{
          ['--adm-len' as string]: String(geometry.length),
          ['--adm-draw-ms' as string]: '760ms',
        }}
      />

      {geometry.last ? (
        <circle cx={geometry.last[0]} cy={geometry.last[1]} r={1.9} fill={stroke} />
      ) : null}
    </svg>
  );
}
