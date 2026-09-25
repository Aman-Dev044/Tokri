'use client';

/**
 * Charts — hand-drawn SVG, no library.
 *
 * ── WHY NOT A CHART LIBRARY ─────────────────────────────────────────────────
 * Three of them would be about 90KB of JavaScript to draw seven bars, and not
 * one ships a theme that reads correctly in both a warm-cream light mode and a
 * near-black dark one without being fought. Every colour below is a token, so
 * these charts follow the theme by construction rather than by configuration.
 *
 * ── A CHART IS NOT AN IMAGE OF DATA ─────────────────────────────────────────
 * Every chart here carries a visually-hidden `<table>` of the same numbers.
 * Not a caption saying "chart of revenue" — the actual values, in a real table,
 * so a screen-reader user gets the data and not a description of a picture
 * they cannot see. The SVG itself is `aria-hidden`.
 *
 * ── THE SHAPE IS THE POINT ──────────────────────────────────────────────────
 * A shop owner is not reading these to the rupee; they are reading them for a
 * silhouette — busy Saturday, dead Tuesday. So the bars are generous, the
 * axis is sparse, and the exact figure lives in a `<title>` tooltip and in the
 * table rather than being crammed onto every bar.
 */

import { useId } from 'react';

/* ================================================================== */
/* Bars                                                                */
/* ================================================================== */

export interface BarDatum {
  label: string;
  value: number;
  /** long form for the tooltip and the hidden table, e.g. "24 Sep 2026" */
  fullLabel?: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  /** how a value becomes a string — paise formatter, count formatter, … */
  format: (value: number) => string;
  /** accessible name; also the hidden table's caption */
  label: string;
  /** which pop hue fills the bars. Defaults to the accent. */
  tone?: 'accent' | 'pop-2' | 'pop-3' | 'pop-4';
  height?: number;
}

const VB_WIDTH = 720;

/**
 * Vertical bars with a zero baseline.
 *
 * The baseline is drawn and labelled even when every value is zero, because a
 * brand-new shop's first week of revenue IS all zeros and a chart that collapses
 * to nothing looks broken rather than empty.
 */
export function BarChart({
  data,
  format,
  label,
  tone = 'accent',
  height = 220,
}: BarChartProps) {
  const id = useId().replace(/:/g, '');
  const padTop = 14;
  const padBottom = 30;
  const plot = height - padTop - padBottom;

  const max = Math.max(...data.map((d) => d.value), 0);
  // A flat-zero series still needs a scale, or every bar divides by zero.
  const scale = max > 0 ? plot / max : 0;

  const slot = data.length > 0 ? VB_WIDTH / data.length : VB_WIDTH;
  const barWidth = Math.max(6, Math.min(56, slot * 0.58));

  return (
    <figure className="ven-chart" data-tone={tone}>
      <svg
        className="ven-chart__svg"
        viewBox={`0 0 ${VB_WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
      >
        {/* Baseline. Always drawn — it is what makes "zero" legible as a
            value rather than as a rendering failure. */}
        <line
          x1={0}
          y1={padTop + plot}
          x2={VB_WIDTH}
          y2={padTop + plot}
          className="ven-chart__axis"
        />
        {data.map((datum, index) => {
          const barHeight = Math.max(datum.value > 0 ? 3 : 0, datum.value * scale);
          const x = index * slot + (slot - barWidth) / 2;
          const y = padTop + plot - barHeight;
          return (
            <g key={`${id}-${datum.label}-${index}`}>
              <rect
                className="ven-chart__bar"
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={Math.min(7, barWidth / 2)}
                style={{ ['--i' as string]: index }}
              >
                <title>{`${datum.fullLabel ?? datum.label}: ${format(datum.value)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      {/* Labels live in HTML, not in the SVG: `preserveAspectRatio="none"`
          stretches the drawing to the container and would stretch the type
          with it. This row shares the same track widths, so a label stays
          under its bar at every size. */}
      <div
        className="ven-chart__ticks"
        style={{ ['--cols' as string]: Math.max(data.length, 1) }}
        aria-hidden="true"
      >
        {data.map((datum, index) => (
          <span key={`${id}-t-${index}`}>{datum.label}</span>
        ))}
      </div>

      <ChartTable label={label} data={data} format={format} />
    </figure>
  );
}

/* ================================================================== */
/* Area                                                                */
/* ================================================================== */

export interface AreaChartProps {
  data: readonly BarDatum[];
  format: (value: number) => string;
  label: string;
  tone?: 'accent' | 'pop-2' | 'pop-3' | 'pop-4';
  height?: number;
}

/**
 * A line with a wash under it, for a trend over time.
 *
 * The line draws itself on mount (`stroke-dashoffset`), which is the one
 * animation that genuinely helps here: the eye follows the stroke left to
 * right and reads the sequence as time rather than as a static silhouette.
 */
export function AreaChart({ data, format, label, tone = 'accent', height = 220 }: AreaChartProps) {
  const id = useId().replace(/:/g, '');
  const padTop = 16;
  const padBottom = 30;
  const plot = height - padTop - padBottom;

  const max = Math.max(...data.map((d) => d.value), 0);
  const scale = max > 0 ? plot / max : 0;

  const step = data.length > 1 ? VB_WIDTH / (data.length - 1) : 0;
  const points = data.map((datum, index) => {
    const x = data.length === 1 ? VB_WIDTH / 2 : index * step;
    const y = padTop + plot - datum.value * scale;
    return { x, y, datum };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const area =
    points.length > 0
      ? `${line} L${points[points.length - 1]?.x ?? 0} ${padTop + plot} L${points[0]?.x ?? 0} ${padTop + plot} Z`
      : '';

  return (
    <figure className="ven-chart" data-tone={tone}>
      <svg
        className="ven-chart__svg"
        viewBox={`0 0 ${VB_WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={padTop + plot}
          x2={VB_WIDTH}
          y2={padTop + plot}
          className="ven-chart__axis"
        />
        {area ? <path className="ven-chart__area" d={area} /> : null}
        {line ? <path className="ven-chart__line" d={line} /> : null}
        {points.map((point, index) => (
          <circle
            key={`${id}-p-${index}`}
            className="ven-chart__dot"
            cx={point.x}
            cy={point.y}
            r={4}
            style={{ ['--i' as string]: index }}
          >
            <title>{`${point.datum.fullLabel ?? point.datum.label}: ${format(point.datum.value)}`}</title>
          </circle>
        ))}
      </svg>

      <div
        className="ven-chart__ticks"
        style={{ ['--cols' as string]: Math.max(data.length, 1) }}
        aria-hidden="true"
      >
        {data.map((datum, index) => (
          <span key={`${id}-at-${index}`}>{datum.label}</span>
        ))}
      </div>

      <ChartTable label={label} data={data} format={format} />
    </figure>
  );
}

/* ================================================================== */
/* Sparkline                                                           */
/* ================================================================== */

/**
 * The seven-day trace on a KPI cell. No axis, no labels — it is a gesture, and
 * the number above it is the fact. It carries no `aria` of its own because the
 * cell it lives in already announces the figure and the period.
 */
export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;

  const width = 120;
  const height = 34;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - 3 - ((value - min) / span) * (height - 6);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="ven-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ven-spark__line" d={path} />
    </svg>
  );
}

/* ================================================================== */
/* Ranked list — for "top products"                                    */
/* ================================================================== */

/**
 * A ranked bar list, not a chart.
 *
 * "Top products by revenue" is eight labelled magnitudes, and a horizontal bar
 * beside its own name beats a rotated axis every time: the name is readable at
 * full size, the bar is comparable at a glance, and the figure is right there
 * in the mono face.
 */
export function RankedBars({
  data,
  format,
  label,
}: {
  data: readonly BarDatum[];
  format: (value: number) => string;
  label: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  return (
    <ol className="ven-rank" aria-label={label}>
      {data.map((datum, index) => (
        <li className="ven-rank__row" key={`${datum.label}-${index}`} style={{ ['--i' as string]: index }}>
          <span className="ven-rank__name" title={datum.fullLabel ?? datum.label}>
            {datum.label}
          </span>
          <span className="ven-rank__track" aria-hidden="true">
            <span
              className="ven-rank__fill"
              style={{ width: `${max > 0 ? Math.max(2, (datum.value / max) * 100) : 0}%` }}
            />
          </span>
          <span className="ven-rank__value">{format(datum.value)}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */

/** The data, as a real table, for anyone who cannot see the drawing. */
function ChartTable({
  label,
  data,
  format,
}: {
  label: string;
  data: readonly BarDatum[];
  format: (value: number) => string;
}) {
  return (
    <table className="ven-sr">
      <caption>{label}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((datum, index) => (
          <tr key={`${datum.label}-${index}`}>
            <th scope="row">{datum.fullLabel ?? datum.label}</th>
            <td>{format(datum.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
