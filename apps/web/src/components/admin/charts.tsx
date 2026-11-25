'use client';

/**
 * Charts, drawn by hand in SVG.
 *
 * ── WHY NO CHART LIBRARY ────────────────────────────────────────────────────
 * Three charts are needed on this console. A charting library is 90–200kB of
 * client JavaScript that arrives with its own colour scale, its own type stack,
 * its own tooltip, and its own idea of what a grid line looks like — all of
 * which then have to be fought back into the token system one override at a
 * time. Three hundred lines of SVG is smaller, themes for free because it reads
 * the same custom properties as everything else, and has no upgrade path to be
 * blocked on.
 *
 * ── COLOUR (plan §2.4) ──────────────────────────────────────────────────────
 * The default series palette is FOUR STEPS OF ONE INK, not four brand hues. A
 * stacked bar is one quantity split up, and painting the splits in unrelated
 * colours tells the eye they are unrelated things.
 *
 * The exception is a breakdown BY AISLE, where the hue IS the datum and matches
 * the swatch beside every product name elsewhere in the console. Those charts
 * pass explicit `color` values from `AISLE_SERIES_COLOR`.
 *
 * ── ACCESSIBILITY ───────────────────────────────────────────────────────────
 * Every chart is `role="img"` with a written summary, and every one is backed
 * by a real table elsewhere on the page or by its own legend with the numbers
 * in it. Nobody on this console has to read a value off a pixel.
 */

import { useMemo, useState, type MouseEvent } from 'react';
import { Tilt3D } from '@mandi/design-system';

/* ================================================================== */
/* Shared                                                              */
/* ================================================================== */

/** A chart row is a flat record; `xKey` and each series `key` index into it. */
export type ChartRow = Record<string, string | number>;

export interface ChartSeries {
  key: string;
  label: string;
  /** any CSS colour, usually a custom property. Defaults to the neutral ramp. */
  color?: string;
}

const NEUTRAL_SERIES = [
  'var(--adm-series-1)',
  'var(--adm-series-2)',
  'var(--adm-series-3)',
  'var(--adm-series-4)',
];

function seriesColor(series: ChartSeries, index: number): string {
  return series.color ?? NEUTRAL_SERIES[index % NEUTRAL_SERIES.length] ?? 'var(--adm-series-1)';
}

function numberAt(row: ChartRow | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function labelAt(row: ChartRow | undefined, key: string): string {
  const value = row?.[key];
  return value === undefined ? '' : String(value);
}

/**
 * A "nice" upper bound and a tick step, so the axis reads 0 / 25 / 50 / 75 /
 * 100 instead of 0 / 23.7 / 47.4. An axis nobody can do arithmetic on is an
 * axis nobody reads.
 */
function niceScale(max: number, ticks: number): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 };
  const rough = max / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10) *
    magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

function pathLength(points: ReadonlyArray<readonly [number, number]>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return Math.ceil(length);
}

/** viewBox width. The SVG scales to its container; the geometry does not. */
const VW = 760;
const PAD = { top: 12, right: 12, bottom: 26, left: 56 } as const;

/* ================================================================== */
/* LineChart                                                           */
/* ================================================================== */

export interface LineChartProps {
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
  /** turns a raw value into the string on the axis and in the tooltip */
  formatValue?: (value: number) => string;
  formatX?: (value: string) => string;
  /** shade under a single-series line */
  area?: boolean;
  label?: string;
}

export function LineChart({
  data,
  xKey,
  series,
  height = 240,
  formatValue = (n) => String(Math.round(n)),
  formatX = (v) => v,
  area = true,
  label,
}: LineChartProps) {
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    const plotW = VW - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    const maxValue = Math.max(
      1,
      ...data.flatMap((row) => series.map((s) => numberAt(row, s.key))),
    );
    const scale = niceScale(maxValue, 4);
    const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

    const lines = series.map((s, si) => {
      const points = data.map((row, i) => {
        const x = PAD.left + i * stepX;
        const y = PAD.top + plotH - (numberAt(row, s.key) / scale.max) * plotH;
        return [x, y] as const;
      });
      const d = points
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ');
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      return {
        series: s,
        color: seriesColor(s, si),
        d,
        length: pathLength(points),
        points,
        areaD:
          firstPoint && lastPoint
            ? `${d} L${lastPoint[0].toFixed(1)} ${PAD.top + plotH} L${firstPoint[0].toFixed(1)} ${PAD.top + plotH} Z`
            : '',
      };
    });

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const value = (scale.max / 4) * i;
      return { value, y: PAD.top + plotH - (value / scale.max) * plotH };
    });

    // Never more than ~7 x labels, or they collide at any container width.
    const every = Math.max(1, Math.ceil(data.length / 7));

    return { plotW, plotH, scale, stepX, lines, yTicks, every };
  }, [data, series, height]);

  if (data.length === 0) {
    return <ChartEmpty height={height} />;
  }

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const x = ratio * VW;
    const index = Math.round((x - PAD.left) / (geo.stepX || 1));
    setActive(index >= 0 && index < data.length ? index : null);
  };

  const activeRow = active === null ? undefined : data[active];
  const activeX = active === null ? 0 : PAD.left + active * geo.stepX;

  return (
    // Depth for hierarchy, not spectacle: a chart panel lifts and tilts a
    // few degrees on hover, gentle enough that the line underneath the
    // pointer stays easy to read. Data TABLES never get this — see
    // DataTable.tsx, which has no Tilt3D anywhere near it.
    <Tilt3D as="div" className="adm-chart-tilt" max={5} lift={10}>
    <div className="adm-chart__wrap">
      <svg
        className="adm-chart"
        viewBox={`0 0 ${VW} ${height}`}
        style={{ height: 'auto' }}
        role="img"
        aria-label={
          label ??
          `Line chart of ${series.map((s) => s.label).join(' and ')} over ${data.length} points`
        }
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
      >
        {/* horizontal grid only — vertical rules on a time axis add ink and
            no information, because the x positions are already evenly spaced */}
        {geo.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className="adm-chart__grid"
              x1={PAD.left}
              x2={VW - PAD.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text className="adm-chart__axis" x={PAD.left - 8} y={tick.y + 3} textAnchor="end">
              {formatValue(tick.value)}
            </text>
          </g>
        ))}

        {data.map((row, i) =>
          i % geo.every === 0 ? (
            <text
              key={`x-${i}`}
              className="adm-chart__axis"
              x={PAD.left + i * geo.stepX}
              y={height - 8}
              textAnchor="middle"
            >
              {formatX(labelAt(row, xKey))}
            </text>
          ) : null,
        )}

        {area && geo.lines.length === 1 && geo.lines[0]
          ? (() => {
              const line = geo.lines[0];
              if (!line) return null;
              return (
                <>
                  <defs>
                    <linearGradient id="adm-line-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={line.color} stopOpacity="0.3" />
                      <stop offset="100%" stopColor={line.color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="adm-chart__area" d={line.areaD} fill="url(#adm-line-area)" />
                </>
              );
            })()
          : null}

        {geo.lines.map((line, i) => (
          <path
            key={line.series.key}
            className="adm-chart__line adm-draw"
            d={line.d}
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.length}
            style={{
              ['--adm-len' as string]: String(line.length),
              ['--adm-draw-ms' as string]: '1000ms',
              ['--adm-draw-delay' as string]: `${i * 110}ms`,
            }}
          />
        ))}

        {active !== null ? (
          <>
            <line
              className="adm-chart__cursor"
              x1={activeX}
              x2={activeX}
              y1={PAD.top}
              y2={PAD.top + geo.plotH}
            />
            {geo.lines.map((line) => {
              const point = line.points[active];
              if (!point) return null;
              return (
                <circle
                  key={`dot-${line.series.key}`}
                  className="adm-chart__dot"
                  cx={point[0]}
                  cy={point[1]}
                  r={3.5}
                  fill="var(--adm-solid)"
                  stroke={line.color}
                  strokeWidth={2}
                />
              );
            })}
          </>
        ) : null}
      </svg>

      {active !== null && activeRow ? (
        <div className="adm-tip" style={{ left: `${(activeX / VW) * 100}%`, top: PAD.top + 8 }}>
          <div className="adm-tip__row" style={{ marginBottom: 4 }}>
            <strong>{formatX(labelAt(activeRow, xKey))}</strong>
          </div>
          {geo.lines.map((line) => (
            <div className="adm-tip__row" key={`tip-${line.series.key}`}>
              <span className="adm-tip__key">
                <span className="adm-swatch" style={{ background: line.color }} />
                {line.series.label}
              </span>
              <span className="adm-tip__val">{formatValue(numberAt(activeRow, line.series.key))}</span>
            </div>
          ))}
        </div>
      ) : null}

      {series.length > 1 ? (
        <div className="adm-legend">
          {geo.lines.map((line) => (
            <span className="adm-legend__item" key={`lg-${line.series.key}`}>
              <span className="adm-swatch" style={{ background: line.color }} />
              {line.series.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
    </Tilt3D>
  );
}

/* ================================================================== */
/* BarChart                                                            */
/* ================================================================== */

export interface BarChartProps {
  data: ChartRow[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
  stacked?: boolean;
  /** draw the bars lying down — the right call when the labels are words */
  horizontal?: boolean;
  formatValue?: (value: number) => string;
  formatX?: (value: string) => string;
  /**
   * Colour each BAR from its own row rather than from its series.
   *
   * Only meaningful for a single-series chart, and only correct when the
   * category itself is the thing the colour encodes — sales-by-aisle is the
   * case this exists for, where the hue matches the <AisleDot/> beside every
   * product name elsewhere on the page. Returning `undefined` falls back to the
   * series colour.
   */
  colorByRow?: (row: ChartRow, index: number) => string | undefined;
  label?: string;
}

export function BarChart({
  data,
  xKey,
  series,
  height = 240,
  stacked = false,
  horizontal = false,
  formatValue = (n) => String(Math.round(n)),
  formatX = (v) => v,
  colorByRow,
  label,
}: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);

  // Word labels need room; a 56px gutter fits "Staples & Gra…" and nothing more.
  const pad = horizontal
    ? { top: 8, right: 56, bottom: 22, left: 118 }
    : { top: 12, right: 12, bottom: 30, left: 56 };

  const geo = useMemo(() => {
    const plotW = VW - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const totals = data.map((row) =>
      stacked
        ? series.reduce((sum, s) => sum + numberAt(row, s.key), 0)
        : Math.max(...series.map((s) => numberAt(row, s.key)), 0),
    );
    const scale = niceScale(Math.max(1, ...totals), 4);

    const bandCount = Math.max(1, data.length);
    const band = (horizontal ? plotH : plotW) / bandCount;
    const groupWidth = band * 0.66;
    const barWidth = stacked ? groupWidth : groupWidth / Math.max(1, series.length);

    const ticks = Array.from({ length: 5 }, (_, i) => (scale.max / 4) * i);

    return { plotW, plotH, scale, band, groupWidth, barWidth, ticks, totals };
  }, [data, series, height, stacked, horizontal, pad.left, pad.right, pad.top, pad.bottom]);

  if (data.length === 0) return <ChartEmpty height={height} />;

  const activeRow = active === null ? undefined : data[active];

  return (
    <Tilt3D as="div" className="adm-chart-tilt" max={5} lift={10}>
    <div className="adm-chart__wrap">
      <svg
        className="adm-chart"
        viewBox={`0 0 ${VW} ${height}`}
        style={{ height: 'auto' }}
        role="img"
        aria-label={label ?? `Bar chart of ${series.map((s) => s.label).join(', ')}`}
        onMouseLeave={() => setActive(null)}
      >
        {/* value axis */}
        {geo.ticks.map((value) => {
          const position = horizontal
            ? pad.left + (value / geo.scale.max) * geo.plotW
            : pad.top + geo.plotH - (value / geo.scale.max) * geo.plotH;
          return horizontal ? (
            <g key={value}>
              <line
                className="adm-chart__grid"
                x1={position}
                x2={position}
                y1={pad.top}
                y2={pad.top + geo.plotH}
              />
              <text
                className="adm-chart__axis"
                x={position}
                y={height - 6}
                textAnchor="middle"
              >
                {formatValue(value)}
              </text>
            </g>
          ) : (
            <g key={value}>
              <line
                className="adm-chart__grid"
                x1={pad.left}
                x2={VW - pad.right}
                y1={position}
                y2={position}
              />
              <text className="adm-chart__axis" x={pad.left - 8} y={position + 3} textAnchor="end">
                {formatValue(value)}
              </text>
            </g>
          );
        })}

        {data.map((row, i) => {
          const bandStart = (horizontal ? pad.top : pad.left) + i * geo.band;
          const groupStart = bandStart + (geo.band - geo.groupWidth) / 2;
          let stackCursor = 0;

          return (
            <g
              key={`band-${i}`}
              onMouseEnter={() => setActive(i)}
              style={{ ['--adm-i' as string]: String(i) }}
            >
              {/* a transparent hit band, so hovering the gap still works */}
              <rect
                className="adm-chart__hit"
                x={horizontal ? pad.left : bandStart}
                y={horizontal ? bandStart : pad.top}
                width={horizontal ? geo.plotW : geo.band}
                height={horizontal ? geo.band : geo.plotH}
              />

              {series.map((s, si) => {
                const value = numberAt(row, s.key);
                const extent = (value / geo.scale.max) * (horizontal ? geo.plotW : geo.plotH);
                const offset = stacked ? stackCursor : si * geo.barWidth;
                if (stacked) stackCursor += extent;

                const color = colorByRow?.(row, i) ?? seriesColor(s, si);

                return horizontal ? (
                  <rect
                    key={s.key}
                    className="adm-chart__bar"
                    x={pad.left + offset}
                    y={groupStart + (stacked ? 0 : si * geo.barWidth)}
                    width={Math.max(0, extent)}
                    height={stacked ? geo.groupWidth : geo.barWidth - 2}
                    fill={color}
                    rx={2}
                    opacity={active === null || active === i ? 1 : 0.55}
                    style={{ ['--adm-i' as string]: String(i) }}
                  />
                ) : (
                  <rect
                    key={s.key}
                    className="adm-chart__bar"
                    x={groupStart + (stacked ? 0 : si * geo.barWidth)}
                    y={pad.top + geo.plotH - extent - (stacked ? offset : 0)}
                    width={stacked ? geo.groupWidth : Math.max(1, geo.barWidth - 2)}
                    height={Math.max(0, extent)}
                    fill={color}
                    rx={2}
                    opacity={active === null || active === i ? 1 : 0.55}
                    style={{ ['--adm-i' as string]: String(i) }}
                  />
                );
              })}

              {/* category label */}
              {horizontal ? (
                <text
                  className="adm-chart__axis"
                  x={pad.left - 10}
                  y={bandStart + geo.band / 2 + 3}
                  textAnchor="end"
                >
                  {formatX(labelAt(row, xKey))}
                </text>
              ) : (
                <text
                  className="adm-chart__axis"
                  x={bandStart + geo.band / 2}
                  y={height - 10}
                  textAnchor="middle"
                >
                  {formatX(labelAt(row, xKey))}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {active !== null && activeRow ? (
        <div
          className="adm-tip"
          style={
            horizontal
              ? { left: '50%', top: pad.top + active * geo.band }
              : {
                  left: `${((pad.left + active * geo.band + geo.band / 2) / VW) * 100}%`,
                  top: pad.top + 8,
                }
          }
        >
          <div className="adm-tip__row" style={{ marginBottom: 4 }}>
            <strong>{formatX(labelAt(activeRow, xKey))}</strong>
          </div>
          {series.map((s, si) => (
            <div className="adm-tip__row" key={`tip-${s.key}`}>
              <span className="adm-tip__key">
                <span
                  className="adm-swatch"
                  style={{ background: colorByRow?.(activeRow, active) ?? seriesColor(s, si) }}
                />
                {s.label}
              </span>
              <span className="adm-tip__val">{formatValue(numberAt(activeRow, s.key))}</span>
            </div>
          ))}
        </div>
      ) : null}

      {series.length > 1 ? (
        <div className="adm-legend">
          {series.map((s, si) => (
            <span className="adm-legend__item" key={`lg-${s.key}`}>
              <span className="adm-swatch" style={{ background: seriesColor(s, si) }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
    </Tilt3D>
  );
}

/* ================================================================== */
/* DonutChart                                                          */
/* ================================================================== */

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  height?: number;
  /** printed under the total in the hole */
  caption?: string;
  formatValue?: (value: number) => string;
  label?: string;
}

/**
 * A part-to-whole split, with the legend carrying the actual numbers.
 *
 * ── THE HOLE IS THE POINT ───────────────────────────────────────────────────
 * A pie asks you to compare wedge areas, which people are famously bad at. The
 * hole holds the total, so the chart answers "how is this split" while the
 * centre answers "out of how many" — and the legend beside it answers "exactly
 * how many", which is what anyone operating this console actually needs.
 *
 * Segments are drawn as dash-arrays on one circle rather than as arc paths:
 * one geometry, no arc-flag arithmetic, and `stroke-dashoffset` gives the
 * draw-in for free.
 */
export function DonutChart({
  data,
  height = 220,
  caption = 'TOTAL',
  formatValue = (n) => String(Math.round(n)),
  label,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0);

  const size = height;
  const stroke = Math.max(16, size * 0.13);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    let cursor = 0;
    return data.map((datum, i) => {
      const fraction = total > 0 ? datum.value / total : 0;
      const length = fraction * circumference;
      const segment = {
        ...datum,
        color: datum.color ?? NEUTRAL_SERIES[i % NEUTRAL_SERIES.length] ?? 'var(--adm-series-1)',
        fraction,
        length,
        offset: cursor,
        index: i,
      };
      cursor += length;
      return segment;
    });
  }, [data, total, circumference]);

  if (data.length === 0 || total === 0) return <ChartEmpty height={height} />;

  return (
    <Tilt3D as="div" className="adm-chart-tilt" max={5} lift={10}>
    <div className="adm-donut__wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label ?? `Donut chart, ${data.length} categories, ${formatValue(total)} total`}
        style={{ flex: '0 0 auto' }}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((segment) => (
            <circle
              key={segment.label}
              className="adm-donut__seg"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={stroke}
              // A 1px gap between segments, so two adjacent similar tones do
              // not merge into one wedge.
              strokeDasharray={`${Math.max(0, segment.length - 1)} ${circumference}`}
              strokeDashoffset={-segment.offset}
              style={{
                ['--adm-len' as string]: String(circumference),
                ['--adm-i' as string]: String(segment.index),
              }}
            >
              <title>{`${segment.label}: ${formatValue(segment.value)}`}</title>
            </circle>
          ))}
        </g>

        <text className="adm-donut__center" x={size / 2} y={size / 2 - 2}>
          <tspan className="adm-donut__total">{formatValue(total)}</tspan>
        </text>
        <text className="adm-donut__center adm-donut__caption" x={size / 2} y={size / 2 + 14}>
          {caption}
        </text>
      </svg>

      <div className="adm-donut__legend">
        {segments.map((segment) => (
          <div className="adm-donut__row" key={`row-${segment.label}`}>
            <span className="adm-swatch" style={{ background: segment.color }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {segment.label}
            </span>
            <span className="adm-num">{formatValue(segment.value)}</span>
            <span className="adm-donut__pct">{(segment.fraction * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
    </Tilt3D>
  );
}

/* ================================================================== */

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--adm-dim)',
        fontSize: 'var(--adm-fs-sm)',
      }}
    >
      No data for this range.
    </div>
  );
}
