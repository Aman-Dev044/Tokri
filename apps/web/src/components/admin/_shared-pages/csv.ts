/**
 * CSV export, built in the browser from rows already on screen.
 *
 * ── WHY CLIENT-SIDE ────────────────────────────────────────────────────────
 * The report table is already loaded and already paginated the way the admin
 * asked for it. Round-tripping to the API to re-derive the same rows would let
 * the file disagree with the screen, which is the one thing an exported report
 * must never do.
 *
 * ── WHERE THIS WORKS, AND WHERE IT DOES NOT ────────────────────────────────
 * A viewer-initiated download works here: this is a first-party Next.js page,
 * the click comes from the user, and an <a download> with an object URL is a
 * normal same-origin navigation.
 *
 * The same code is INERT inside a published Claude Artifact. Artifacts render
 * in a sandboxed frame where any download the page starts itself — <a download>
 * with a data: or blob: href included, and script-driven saves — is blocked
 * silently. If any of this is ever lifted into an artifact, the export has to
 * become "render the CSV into a <pre> and let the reader copy it", not a
 * download button that appears to do nothing.
 */

/** RFC 4180: quote when needed, double an embedded quote. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  /**
   * The RAW value for the file. Money must be handed over as rupees or as
   * paise with the unit in the header — never as a pre-formatted "₹1,234.50",
   * which no spreadsheet will parse back into a number.
   */
  value: (row: T) => string | number | null;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','));
  // \r\n, because Excel on Windows is the overwhelmingly likely destination.
  return [head, ...body].join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  // A BOM, so Excel reads the file as UTF-8 instead of the system codepage and
  // turns ₹ into mojibake.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** `mandi-sales-2026-09-24.csv` */
export function csvFilename(prefix: string, iso: string): string {
  return `mandi-${prefix}-${iso.slice(0, 10)}.csv`;
}
