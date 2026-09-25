/**
 * Turning two JSON snapshots into something a human can actually read.
 *
 * An audit row stores `before` and `after` as whole documents. Printing both
 * side by side is technically complete and practically useless — forty
 * unchanged keys bury the one that moved. So:
 *
 *   1. Both sides are FLATTENED to dotted paths, so a change three levels down
 *      (`pricing.commissionAmount`) reads as one line rather than as a diff of
 *      two pretty-printed blobs.
 *   2. Every path is classified: changed, added, removed, or unchanged.
 *   3. The page shows the first three and collapses the fourth behind a count.
 *
 * ── REDACTION ───────────────────────────────────────────────────────────────
 * The API redacts sensitive fields before they ever reach an audit row. A
 * redacted value MUST NOT be drawn as though it were the real one: printing
 * `"[REDACTED]"` as a plain string invites someone to read it as a password
 * that literally says that. `classifyValue` marks these, and the renderer
 * draws a marker chip instead of a value.
 *
 * Key-name detection is belt and braces on top of the API's own redaction: if
 * a field called `passwordHash` ever slips through un-redacted, this still
 * refuses to print it.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ChangeKind = 'changed' | 'added' | 'removed' | 'unchanged';

export interface DiffLine {
  path: string;
  kind: ChangeKind;
  before: Json | undefined;
  after: Json | undefined;
  /** true when either side must be drawn as a marker, never as a value */
  redacted: boolean;
}

/** Literal markers the API uses to stand in for a value it will not emit. */
const REDACTION_MARKERS: ReadonlySet<string> = new Set([
  '[REDACTED]',
  '[redacted]',
  '<redacted>',
  'REDACTED',
  '***',
  '********',
]);

/** Field names that must never be printed even if a value arrives. */
const SENSITIVE_SEGMENTS: readonly string[] = [
  'password',
  'passwordhash',
  'otp',
  'otphash',
  'deliveryotphash',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'pepper',
  'signature',
  'apikey',
  'cvv',
  'pan',
  'aadhaar',
];

function isPlainObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathIsSensitive(path: string): boolean {
  return path
    .split('.')
    .some((segment) => SENSITIVE_SEGMENTS.includes(segment.toLowerCase()));
}

function valueIsMarker(value: Json | undefined): boolean {
  return typeof value === 'string' && REDACTION_MARKERS.has(value);
}

/**
 * Flattens to dotted paths. Arrays are kept whole rather than indexed: a
 * re-ordered ten-item array would otherwise read as ten separate changes,
 * which is noise rather than information.
 */
function flatten(value: Json | undefined, prefix: string, out: Map<string, Json>): void {
  if (value === undefined) return;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.set(prefix === '' ? '{}' : prefix, {});
      return;
    }
    for (const key of keys) {
      const next = value[key];
      if (next === undefined) continue;
      flatten(next, prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  out.set(prefix, value);
}

function sameValue(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Arrays and leftover objects compare structurally. Key order is not
  // meaningful in JSON, so it is normalised away first.
  return stableStringify(a) === stableStringify(b);
}

export function stableStringify(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function diffSnapshots(before: Json | null, after: Json | null): DiffLine[] {
  const left = new Map<string, Json>();
  const right = new Map<string, Json>();
  flatten(before ?? undefined, '', left);
  flatten(after ?? undefined, '', right);

  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();

  return paths.map((path) => {
    const hasLeft = left.has(path);
    const hasRight = right.has(path);
    const leftValue = left.get(path);
    const rightValue = right.get(path);

    const kind: ChangeKind = !hasLeft
      ? 'added'
      : !hasRight
        ? 'removed'
        : sameValue(leftValue, rightValue)
          ? 'unchanged'
          : 'changed';

    return {
      path,
      kind,
      before: hasLeft ? leftValue : undefined,
      after: hasRight ? rightValue : undefined,
      redacted:
        pathIsSensitive(path) || valueIsMarker(leftValue) || valueIsMarker(rightValue),
    };
  });
}

export interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
}

export function summarise(lines: readonly DiffLine[]): DiffSummary {
  const summary: DiffSummary = { changed: 0, added: 0, removed: 0, unchanged: 0 };
  for (const line of lines) summary[line.kind] += 1;
  return summary;
}

/** A path ending in `Paise` is integer paise and must render as money. */
export function isMoneyPath(path: string): boolean {
  const last = path.split('.').pop() ?? '';
  return /paise$/i.test(last) || /amount$/i.test(last);
}
