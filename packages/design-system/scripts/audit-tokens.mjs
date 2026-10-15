#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE TOKEN AUDIT
 * ════════════════════════════════════════════════════════════════════════
 *
 * A custom property is the one part of CSS with no failure mode. Misspell a
 * selector and nothing matches; misspell a property and the linter speaks
 * up. But read a token that does not exist, or hand one the wrong SHAPE,
 * and the browser discards the whole declaration in silence. The element
 * keeps its inherited background, its missing radius, its absent focus
 * ring, and the page still renders — just slightly wrong, in a way only an
 * eye catches, usually days later.
 *
 * This has now cost two repaints:
 *
 *   · "Bento Pop" dropped a dozen names the shipped stylesheets still
 *     read, which blanked Button, Input, Checkbox, the loader and the toast
 *     at once. Found by eye, days later.
 *
 *   · "Paper" restored all those names but gave two of them the wrong
 *     shape: --focus-halo and --aisle-glow became complete shadows while
 *     all six of their consumers spend them in a COLOUR slot, as
 *     `box-shadow: 0 0 0 4px var(--focus-halo)`. That expands to
 *     `0 0 0 4px 0 0 0 4px <colour>` — invalid, dropped, and the keyboard
 *     focus ring quietly vanished from every page outside the shop, which
 *     happens to carry its own override.
 *
 * Both failures are mechanical. So they are checked mechanically, on every
 * lint, which is why this runs from the package's `lint` script rather than
 * living in a notebook somewhere.
 *
 * ── The three checks ────────────────────────────────────────────────────
 *   1. UNDEFINED — something reads a token nothing defines, with no
 *      fallback to fall back to.
 *   2. SLOT SHAPE — a token used where a paint belongs is a paint, and one
 *      used where a whole shadow belongs is a shadow.
 *   3. drop-shadow ARITY — drop-shadow() accepts three lengths. A focus
 *      ring has four, so a ring token cannot be spent there.
 *
 * ── What it deliberately does NOT check ─────────────────────────────────
 * Unused definitions. A design system is allowed to offer more vocabulary
 * than today's screens consume, and failing a build over an unused token
 * would push people to delete vocabulary rather than keep it coherent.
 */

import { globSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SOURCES = [
  'packages/design-system/src/**/*.css',
  'packages/design-system/src/**/*.tsx',
  'packages/design-system/src/**/*.ts',
  'apps/web/src/**/*.css',
  'apps/web/src/**/*.tsx',
];

const files = SOURCES.flatMap((pattern) =>
  globSync(pattern, { cwd: ROOT }).map((found) => join(ROOT, found)),
);

/** A length, including the unitless zero that every shadow is full of. */
const LEN = String.raw`-?[\d.]+(?:px|rem|em|vh|vw|%)|0`;
const TOKEN = String.raw`--[\w-]+`;

/**
 * Blank out comment bodies while keeping every newline, so the line numbers
 * in the report still point at the real line. Prose about tokens is the
 * single biggest source of false positives here — this file's own header
 * names two tokens in a sentence, and tokens.css explains itself at length —
 * and a check that reports its own documentation gets switched off.
 */
const decomment = (raw) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));

/**
 * token -> raw value, gathered from every source, locals included.
 *
 * `defs` holds the first definition seen, which is all the undefined-read
 * check needs. `variants` holds EVERY definition, and that distinction
 * matters: a token is routinely redefined per theme, and a shape mismatch
 * can live in one theme while the other looks fine. The rider surface hid
 * exactly that — `--hot-glow-sm` is a 3-length blur by default and a
 * 4-length ring under `prefers-color-scheme: light`, so the one rule
 * filtering the countdown ring was valid in the dark and dropped on paper.
 * First-definition-wins reported that as clean.
 */
const defs = new Map();
const variants = new Map();
const text = new Map();

const define = (name, value) => {
  if (!defs.has(name)) defs.set(name, value);
  if (!variants.has(name)) variants.set(name, new Set());
  variants.get(name).add(value);
};

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  text.set(file, raw);
  const body = decomment(raw);

  for (const [, name, value] of body.matchAll(
    new RegExp(String.raw`(${TOKEN})\s*:\s*([^;\n}]+)`, 'g'),
  )) {
    define(name, value.trim());
  }

  // React sets custom properties through an object key:
  //   style={{ ['--tilt-max']: `${max}deg` }}
  for (const [, name] of body.matchAll(new RegExp(String.raw`\[\s*'(${TOKEN})'`, 'g'))) {
    define(name, '<inline style>');
  }

  // next/font declares its faces in TypeScript, not CSS:
  //   const display = localFont({ variable: '--font-display', ... })
  // Next then puts that property on a class the <html> element carries, so
  // the token resolves at runtime even though no stylesheet writes it.
  // Without this the audit calls all three font stacks undefined, which is
  // exactly how a correct check earns a reputation for crying wolf.
  for (const [, name] of body.matchAll(new RegExp(String.raw`variable:\s*'(${TOKEN})'`, 'g'))) {
    define(name, '<next/font>');
  }
}

/** Classify ONE value: does it paint, or is it a whole shadow? */
function shapeOfValue(value, seen) {
  const alias = new RegExp(String.raw`^var\((${TOKEN})\)$`).exec(value);
  if (alias) return shapesOf(alias[1], seen);
  if (new RegExp(String.raw`^(?:inset\s+)?(?:${LEN})\s+(?:${LEN})[\s,]`).test(value)) {
    return new Set(['shadow']);
  }
  if (/^(#|rgb|hsl|oklch|oklab|color-mix|transparent|currentColor)/.test(value)) {
    return new Set(['colour']);
  }
  return new Set(['unknown']);
}

/**
 * Every shape a token takes across all its definitions. A set, not a
 * single answer, because a token redefined per theme can legitimately keep
 * its shape in one and lose it in the other — and the one that loses it is
 * the bug, whichever came first in the file.
 */
function shapesOf(name, seen = new Set()) {
  if (seen.has(name) || !variants.has(name)) return new Set(['unknown']);
  const next = new Set([...seen, name]);
  const out = new Set();
  for (const value of variants.get(name)) {
    for (const shape of shapeOfValue(value, next)) out.add(shape);
  }
  return out;
}

/** True when ANY definition of the token has this shape. */
const everTakes = (name, shape) => shapesOf(name).has(shape);

const problems = [];
const reported = new Set();

const note = (file, line, token, message) => {
  const key = [file, line, token, message].join('|');
  if (reported.has(key)) return;
  reported.add(key);
  problems.push({
    file: relative(ROOT, file).split(sep).join('/'),
    line,
    token,
    message,
  });
};

for (const [file, raw] of text) {
  decomment(raw)
    .split(/\r?\n/)
    .forEach((line, index) => {
      const lineNo = index + 1;

      // ── 1. undefined reads ──────────────────────────────────────────
      // A read WITH a fallback is intentional and skipped: there, the
      // fallback is the contract. Only a bare read of an unknown name is a
      // defect, because that one has nothing to fall back to.
      for (const [, token] of line.matchAll(new RegExp(String.raw`var\((${TOKEN})\s*\)`, 'g'))) {
        if (!defs.has(token)) {
          note(file, lineNo, token, 'read but never defined — the declaration is dropped');
        }
      }

      if (!line.includes('shadow')) return;

      // ── 2. slot shape ───────────────────────────────────────────────
      for (const [, token] of line.matchAll(
        new RegExp(String.raw`(?:${LEN})\s+var\((${TOKEN})\s*\)`, 'g'),
      )) {
        if (everTakes(token, 'shadow')) {
          note(file, lineNo, token, 'sits in a COLOUR slot but is defined as a whole shadow');
        }
      }
      for (const [, token] of line.matchAll(
        new RegExp(String.raw`box-shadow:\s*var\((${TOKEN})\s*\)\s*[;,]`, 'g'),
      )) {
        if (everTakes(token, 'colour') && !everTakes(token, 'shadow')) {
          note(file, lineNo, token, 'sits in a SHADOW slot but is defined as a colour');
        }
      }

      // ── 3. drop-shadow arity ────────────────────────────────────────
      for (const [, token] of line.matchAll(
        new RegExp(String.raw`drop-shadow\(\s*var\((${TOKEN})\s*\)`, 'g'),
      )) {
        for (let value of variants.get(token) ?? []) {
          const alias = new RegExp(String.raw`^var\((${TOKEN})\)$`).exec(value);
          if (alias) value = defs.get(alias[1]) ?? value;
          const lengths = value.split(',')[0].match(new RegExp(LEN, 'g')) ?? [];
          if (lengths.length > 3) {
            note(
              file,
              lineNo,
              token,
              'drop-shadow() takes 3 lengths; one definition of this token has ' +
                lengths.length +
                ' (' + value.trim() + ')',
            );
          }
        }
      }
    });
}

const scanned = files.length + ' files, ' + defs.size + ' tokens';

if (problems.length === 0) {
  console.log('token audit: clean (' + scanned + ')');
  process.exit(0);
}

console.error('\ntoken audit: ' + problems.length + ' problem(s) (' + scanned + ')\n');
for (const problem of problems) {
  console.error('  ' + problem.file + ':' + problem.line);
  console.error('    ' + problem.token + ' — ' + problem.message);
}
console.error(
  '\nEvery line above is a CSS declaration the browser throws away without\n' +
    'an error. Fix the token, not the consumer — unless the consumer is the\n' +
    'one asking for the wrong shape.\n',
);
process.exit(1);
