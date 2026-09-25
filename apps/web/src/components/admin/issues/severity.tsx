'use client';

/**
 * How urgent is this, how old is it, and is it past due.
 *
 * ── WHY THESE PILLS ARE NOT `<StatusPill/>` ─────────────────────────────────
 * The shared pill maps a status to a tone per DOMAIN — order, vendor, user,
 * payment, settlement. A support issue is none of those, and feeding it
 * `open` / `in_progress` would land every chip on the neutral fallback, which
 * is precisely the information this page cannot afford to lose. Rather than
 * widen a component three other screens depend on, the queue keeps its own
 * chips here and obeys the same house rule: a hue, a glyph, and the word.
 *
 * ── THE AGE TARGETS ─────────────────────────────────────────────────────────
 * These are response targets, not contractual SLAs — there is no SLA config in
 * the API yet. They exist so "old" means something specific and consistent:
 * four hours is a long time for an urgent ticket and nothing at all for a low
 * one, and a single shared threshold would make the column useless for both.
 *
 * TODO: read these from platform settings once Worker A exposes them, so
 * support can retune the queue without a deploy.
 */

import type { ReactNode } from 'react';

import { formatDate } from '@/lib/admin/format';

import styles from './issues.module.css';
import {
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  ISSUE_TYPE_LABEL,
  type Issue,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from './fixtures';

/* ------------------------------------------------------------------ */
/* Ranks                                                               */
/* ------------------------------------------------------------------ */

export const PRIORITY_RANK: Record<IssuePriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/** Live work outranks finished work, whatever its priority was. */
export const STATUS_WEIGHT: Record<IssueStatus, number> = {
  open: 2,
  in_progress: 2,
  resolved: 1,
  closed: 0,
};

/** Hours before a ticket at this priority is past its response target. */
export const AGE_TARGET_HOURS: Record<IssuePriority, number> = {
  urgent: 4,
  high: 12,
  normal: 48,
  low: 120,
};

export function isOpenish(status: IssueStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

/**
 * The default ordering: urgent first, and within a priority the oldest first.
 *
 * Composed into ONE number so it can ride through `sortRows`, which takes a
 * single comparable per row. The bands cannot collide — a millisecond epoch is
 * ~1.8e12 and sits well inside the 1e13 priority band, which in turn sits
 * inside the 1e16 status band. Subtracting the timestamp is what makes older
 * sort higher under a descending sort.
 */
export function urgencyScore(issue: Issue): number {
  const created = Date.parse(issue.createdAt);
  const age = Number.isNaN(created) ? 0 : created;
  return STATUS_WEIGHT[issue.status] * 1e16 + PRIORITY_RANK[issue.priority] * 1e13 - age;
}

export function ageHours(createdAt: string, now: number | null): number | null {
  if (now === null) return null;
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return null;
  return Math.max(0, (now - started) / 3_600_000);
}

/** How far through its response target a ticket is. 1 means "due now". */
export function agePressure(issue: Issue, now: number | null): number | null {
  const hours = ageHours(issue.createdAt, now);
  if (hours === null) return null;
  return hours / AGE_TARGET_HOURS[issue.priority];
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

type ChipTone = 'good' | 'warn' | 'crit' | 'info' | 'muted';

const CHIP_CLASS: Record<ChipTone, string> = {
  good: styles.chipGood ?? '',
  warn: styles.chipWarn ?? '',
  crit: styles.chipCrit ?? '',
  info: styles.chipInfo ?? '',
  muted: styles.chipMuted ?? '',
};

function Chip({
  tone,
  glyph,
  children,
  title,
}: {
  tone: ChipTone;
  /** a distinct silhouette, so the chip survives being read in greyscale */
  glyph: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`${styles.chip} ${CHIP_CLASS[tone]}`} title={title}>
      <span className={styles.chipGlyph} aria-hidden="true">
        {glyph}
      </span>
      {children}
    </span>
  );
}

const PRIORITY_CHIP: Record<IssuePriority, { tone: ChipTone; glyph: string }> = {
  urgent: { tone: 'crit', glyph: '▲' },
  high: { tone: 'warn', glyph: '◆' },
  normal: { tone: 'info', glyph: '●' },
  low: { tone: 'muted', glyph: '–' },
};

export function PriorityChip({ priority }: { priority: IssuePriority }) {
  const spec = PRIORITY_CHIP[priority];
  return (
    <Chip tone={spec.tone} glyph={spec.glyph}>
      {ISSUE_PRIORITY_LABEL[priority]}
    </Chip>
  );
}

const STATUS_CHIP: Record<IssueStatus, { tone: ChipTone; glyph: string }> = {
  open: { tone: 'warn', glyph: '○' },
  in_progress: { tone: 'info', glyph: '◐' },
  resolved: { tone: 'good', glyph: '✓' },
  closed: { tone: 'muted', glyph: '×' },
};

export function IssueStatusChip({ status }: { status: IssueStatus }) {
  const spec = STATUS_CHIP[status];
  return (
    <Chip tone={spec.tone} glyph={spec.glyph}>
      {ISSUE_STATUS_LABEL[status]}
    </Chip>
  );
}

export function TypeChip({ type }: { type: IssueType }) {
  return (
    <Chip tone="muted" glyph="§">
      {ISSUE_TYPE_LABEL[type]}
    </Chip>
  );
}

/* ------------------------------------------------------------------ */
/* Age                                                                 */
/* ------------------------------------------------------------------ */

function shortAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.floor(hours % 24);
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/**
 * Age, with how close it is to its target.
 *
 * Three reads of one fact: the number, the colour, and a bar that fills as the
 * target approaches. A resolved ticket shows its age plainly and no pressure —
 * the clock stopped when somebody answered it.
 */
export function AgeCell({ issue, now }: { issue: Issue; now: number | null }) {
  const hours = ageHours(issue.createdAt, now);

  if (hours === null) {
    // Pre-hydration. The absolute date is deterministic on both sides.
    return <span className={`${styles.age} ${styles.ageOk}`}>{formatDate(issue.createdAt, 'day')}</span>;
  }

  const live = isOpenish(issue.status);
  const target = AGE_TARGET_HOURS[issue.priority];
  const pressure = hours / target;

  const state = !live ? 'ok' : pressure >= 1 ? 'breached' : pressure >= 0.6 ? 'warn' : 'ok';
  const mark = state === 'breached' ? '▲' : state === 'warn' ? '◆' : '';
  const toneClass =
    state === 'breached' ? styles.ageBreached : state === 'warn' ? styles.ageWarn : styles.ageOk;
  const fillClass =
    state === 'breached'
      ? `${styles.ageBarFill} ${styles.ageBarFillCrit}`
      : state === 'warn'
        ? `${styles.ageBarFill} ${styles.ageBarFillWarn}`
        : styles.ageBarFill;

  const title = live
    ? `Open ${shortAge(hours)}. Target for a ${ISSUE_PRIORITY_LABEL[issue.priority].toLowerCase()} issue is ${target}h.` +
      (state === 'breached' ? ' Past target.' : '')
    : `Raised ${formatDate(issue.createdAt, 'long')}.`;

  return (
    <span title={title}>
      <span className={`${styles.age} ${toneClass}`}>
        {mark === '' ? null : (
          <span className={styles.ageMark} aria-hidden="true">
            {mark}
          </span>
        )}
        {shortAge(hours)}
        {state === 'breached' ? <span className="adm-sr"> — past its {target} hour target</span> : null}
      </span>
      {live ? (
        <span className={styles.ageBar} aria-hidden="true">
          <span
            className={fillClass}
            style={{ width: `${Math.min(100, Math.round(pressure * 100))}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}
