'use client';

import { Tilt3D } from '@mandi/design-system';
import { useCountUp } from '@/hooks';
import { formatCount, formatPaise, formatPct } from '@/lib/admin/format';
import { IconArrowUp, IconOverview, IconPayments, IconReports } from './icons';
import { Sparkline, type SparkTone } from './Sparkline';

export type KpiTone = 'neutral' | 'good' | 'warn' | 'crit';

export interface KpiTileProps {
  label: string;
  /**
   * The number itself. Money is INTEGER PAISE and must be marked `unit="paise"`
   * — that is what tells the tile to render it as currency rather than as a
   * count with a hundred times too many digits.
   */
  value: number;
  /** signed percentage change against the previous window */
  delta?: number;
  /** what the delta is measured against — "vs previous 30 days" */
  deltaLabel?: string;
  /** trailing series, oldest first */
  spark?: number[];
  /** 'paise' renders currency; '%' and anything else is a suffix */
  unit?: string;
  tone?: KpiTone;
  loading?: boolean;
  /** sample data — puts a SAMPLE stamp on the tile itself */
  isFixture?: boolean;
  /** stagger index, so a row of tiles arrives as a wave */
  index?: number;
  /** a lower delta is better here (cancellation rate), so invert the colours */
  invertDelta?: boolean;
  className?: string;
}

/**
 * The tile's cream icon badge. Purely decorative (the label carries the
 * meaning), so it is picked from what the number IS rather than asked for:
 * money gets the wallet, a rate gets the chart, a count gets the bars.
 */
function badgeIconFor(unit: string | undefined) {
  if (unit === 'paise') return IconPayments;
  if (unit === '%') return IconReports;
  return IconOverview;
}

const SPARK_TONE: Record<KpiTone, SparkTone> = {
  neutral: 'neutral',
  good: 'good',
  warn: 'warn',
  crit: 'crit',
};

/**
 * One number, its trend, and its direction of travel.
 *
 * ── THE COUNT-UP ────────────────────────────────────────────────────────────
 * React renders the FINAL value; `useCountUp` animates the DOM text over it and
 * lands exactly back on that string. So the server HTML is correct, the first
 * paint is correct, and a reduced-motion user simply never sees the ramp. See
 * hooks/useCountUp.ts for why the obvious state-based version is wrong.
 *
 * ── WHY `invertDelta` EXISTS ────────────────────────────────────────────────
 * Up is not good. Cancellation rate rising by 12% is the worst number on the
 * dashboard, and painting it green because the arrow points up is how a tile
 * ends up actively misleading the person reading it.
 */
export function KpiTile({
  label,
  value,
  delta,
  deltaLabel,
  spark,
  unit,
  tone = 'neutral',
  loading = false,
  isFixture = false,
  index = 0,
  invertDelta = false,
  className,
}: KpiTileProps) {
  const isMoney = unit === 'paise';

  const format = (n: number): string => {
    if (isMoney) return formatPaise(Math.round(n));
    if (unit === '%') return `${(Math.round(n * 10) / 10).toFixed(1)}`;
    return formatCount(Math.round(n));
  };

  const countRef = useCountUp(value, { format, delayMs: index * 55 });
  const BadgeIcon = badgeIconFor(unit);

  if (loading) {
    return (
      <div className="adm-tile" aria-busy="true">
        <div className="adm-tile__head">
          <span className="adm-skel" style={{ width: 38, height: 38, flex: '0 0 auto' }} />
          <div className="adm-skel adm-skel--line" style={{ width: '55%' }} />
        </div>
        <div className="adm-skel adm-skel--line" style={{ height: 26, width: '70%' }} />
        <div className="adm-tile__foot">
          <div className="adm-skel adm-skel--line" style={{ width: 72 }} />
          <div className="adm-skel adm-skel--line" style={{ width: 92, height: 24 }} />
        </div>
        <span className="adm-sr">Loading {label}</span>
      </div>
    );
  }

  const deltaDirection =
    delta === undefined || Math.abs(delta) < 0.05
      ? 'flat'
      : invertDelta
        ? delta > 0
          ? 'down'
          : 'up'
        : delta > 0
          ? 'up'
          : 'down';

  return (
    // Tilt3D wraps the tile rather than replacing it: the wrapper owns the
    // pointer-tracked perspective/tilt, the <article> underneath keeps every
    // data-attribute and class the rest of the stylesheet already selects
    // on, untouched. Depth here is hierarchy, not spectacle — a small lift
    // and a few degrees of tilt, never enough to make the number hard to
    // read while it is still counting up.
    <Tilt3D as="div" className="adm-tile-tilt" max={6} lift={10} glow={tone === 'crit'}>
      <article
        className={['adm-tile', className].filter(Boolean).join(' ')}
        data-tone={tone}
        data-fixture={isFixture ? 'true' : undefined}
        style={{ ['--adm-i' as string]: String(index) }}
      >
        <div className="adm-tile__head">
          <span className="adm-tile__badge" aria-hidden="true">
            <BadgeIcon />
          </span>
          <p className="adm-tile__label">{label}</p>
        </div>

        <p className="adm-tile__value">
          {/* The ref'd span holds exactly the animated string; the unit sits
              outside it so the ramp never rewrites the suffix. */}
          <span ref={countRef}>{format(value)}</span>
          {unit && !isMoney ? <span className="adm-tile__unit">{unit}</span> : null}
        </p>

        <div className="adm-tile__foot">
          {delta === undefined ? (
            <span />
          ) : (
            <span className="adm-delta" data-dir={deltaDirection}>
              {deltaDirection === 'flat' ? null : (
                <IconArrowUp
                  style={{
                    transform: delta < 0 ? 'rotate(180deg)' : undefined,
                  }}
                />
              )}
              {formatPct(delta, true)}
              {deltaLabel ? <span className="adm-delta__label">{deltaLabel}</span> : null}
            </span>
          )}

          {spark && spark.length > 1 ? (
            <Sparkline
              data={spark}
              tone={SPARK_TONE[tone]}
              label={`${label} trend, ${spark.length} points`}
            />
          ) : null}
        </div>
      </article>
    </Tilt3D>
  );
}
