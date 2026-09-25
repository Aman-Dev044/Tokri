'use client';

import { useMemo, useState } from 'react';

import { Money } from '@/components/admin';

import styles from '../_shared-pages/pages.module.css';
import {
  diffSnapshots,
  isMoneyPath,
  stableStringify,
  summarise,
  type DiffLine,
  type Json,
} from './diff';

/**
 * A redacted value is drawn as a marker, never as a value.
 *
 * The whole point is that the reader can tell the difference between "the
 * field was set to this" and "we are not showing you what it was set to".
 */
function Redacted() {
  return (
    <span className={styles.redacted} title="This value is withheld by the API">
      redacted
    </span>
  );
}

function Value({ path, value }: { path: string; value: Json | undefined }) {
  if (value === undefined) return <span className={styles.nullish}>absent</span>;
  if (value === null) return <span className={styles.nullish}>null</span>;
  if (typeof value === 'boolean') return <>{value ? 'true' : 'false'}</>;

  if (typeof value === 'number' && isMoneyPath(path)) {
    // Money is integer paise everywhere (plan §5.2) — through <Money/>, never
    // divided here.
    return <Money value={value} />;
  }

  if (typeof value === 'number') return <>{value}</>;
  if (typeof value === 'string') return <>{value === '' ? <span className={styles.nullish}>empty string</span> : value}</>;

  return <>{stableStringify(value)}</>;
}

export function AuditDiff({ before, after }: { before: Json | null; after: Json | null }) {
  const lines = useMemo(() => diffSnapshots(before, after), [before, after]);
  const summary = useMemo(() => summarise(lines), [lines]);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const moved = lines.filter((line) => line.kind !== 'unchanged');
  const unchanged = lines.filter((line) => line.kind === 'unchanged');
  const shown: DiffLine[] = showUnchanged ? [...moved, ...unchanged] : moved;

  if (lines.length === 0) {
    return (
      <div className={styles.diff}>
        <p className={styles.diffEmpty}>
          This action recorded no before/after snapshot. Reads and exports are logged without one.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.diff}>
      <div className={styles.diffHead}>
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>

      {moved.length === 0 && !showUnchanged ? (
        <p className={styles.diffEmpty}>
          Nothing changed — all {summary.unchanged} fields are identical on both sides.
        </p>
      ) : null}

      {shown.map((line) => {
        const kindClass =
          line.kind === 'changed'
            ? styles.diffChanged
            : line.kind === 'added'
              ? styles.diffAdded
              : line.kind === 'removed'
                ? styles.diffRemoved
                : '';

        return (
          <div key={line.path} className={`${styles.diffRow} ${kindClass}`}>
            <span className={styles.diffKey}>{line.path}</span>
            <span className={styles.diffBefore}>
              {line.redacted && line.before !== undefined ? (
                <Redacted />
              ) : (
                <Value path={line.path} value={line.before} />
              )}
            </span>
            <span className={styles.diffAfter}>
              {line.redacted && line.after !== undefined ? (
                <Redacted />
              ) : (
                <Value path={line.path} value={line.after} />
              )}
            </span>
          </div>
        );
      })}

      {unchanged.length === 0 ? null : (
        <button
          type="button"
          className={styles.diffUnchangedToggle}
          aria-expanded={showUnchanged}
          onClick={() => setShowUnchanged((prev) => !prev)}
        >
          {showUnchanged
            ? `Hide ${unchanged.length} unchanged field${unchanged.length === 1 ? '' : 's'}`
            : `Show ${unchanged.length} unchanged field${unchanged.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
