#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  CHECK THE REFERENCE AGAINST THE SERVICE
 * ════════════════════════════════════════════════════════════════════════
 *
 *   pnpm --filter @mandi/api docs:verify     (API must be running)
 *
 * `docs:api` generates the reference by reading decorators. This runs it.
 *
 * The claim worth checking is the one a reader will act on: "this endpoint
 * needs role X". If the generator misreads a decorator it will tell
 * somebody to use a customer token on a vendor route, and they will be
 * refused by the very API the document describes.
 *
 * That is not hypothetical — writing this caught two real defects:
 *
 *   · `GET /auth/me` was published as PUBLIC. `@Get('me')` sits directly
 *     above `@Public() @Post('register/request-otp')`, and the generator's
 *     scope reached across the gap into the next route's decorators.
 *
 *   · Every route in `orders.controller.ts` was published as open to any
 *     signed-in user. The file declares `export class CancelOrderDto`
 *     above the controller, and the generator cut its class-header at the
 *     first `export class` — leaving the controller's own
 *     `@Roles(Role.CUSTOMER)` outside the header it was reading.
 *
 * ── What it exercises, and what it will not ─────────────────────────────
 * GET requests only, and only those without a path parameter. A
 * verification pass has no business creating orders or verifying anybody's
 * KYC, and an invented id answers 404 or 400 — neither of which says
 * anything about authorisation.
 *
 * Per request:
 *   · with the documented role's token  -> must NOT be 401 or 403
 *   · with no token at all              -> must BE 401/403 if protected,
 *                                          and must succeed if public
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const COLLECTION = join(ROOT, 'docs', 'tokri-api.postman_collection.json');
const BASE = process.env.DOCS_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * The seeded accounts, READ FROM `.env` — never written here, for the same
 * reason as in `build-api-docs.mjs`: this script is committed, `.env` is not.
 */
function readSeedAccounts() {
  let text = '';
  try {
    text = readFileSync(join(ROOT, 'apps', 'api', '.env'), 'utf8');
  } catch {
    return null;
  }
  const env = {};
  for (const line of text.split(String.fromCharCode(10))) {
    const m = /^([A-Z0-9_]+)=([\s\S]*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  const rows = [
    ['superAdminToken', 'SUPERADMIN'],
    ['adminToken', 'ADMIN'],
    ['vendorToken', 'VENDOR'],
    ['customerToken', 'CUSTOMER'],
    ['riderToken', 'DELIVERY'],
  ];
  const out = {};
  for (const [variable, key] of rows) {
    const identifier = env[`SEED_${key}_EMAIL`];
    const password = env[`SEED_${key}_PASSWORD`];
    if (!identifier || !password) return null;
    out[variable] = [identifier, password];
  }
  return out;
}

const CREDS = readSeedAccounts();
if (CREDS === null) {
  console.error('Could not read the SEED_* accounts from apps/api/.env.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, text: await res.text() };
  } catch (cause) {
    return { status: 0, text: String(cause) };
  }
}

/* ── sign in as every role ───────────────────────────────────────────── */

const tokens = {};
for (const [variable, [identifier, password]] of Object.entries(CREDS)) {
  let result;
  // Login is throttled per IP per minute and five roles sits right at the
  // limit. A 429 here would empty `tokens`, every later check would be
  // skipped, and the run would print a clean pass having verified nothing.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    result = await call('POST', `${BASE}/auth/login`, null, { identifier, password });
    if (result.status !== 429) break;
    await sleep(12_000);
  }
  if (result.status === 200) tokens[variable] = JSON.parse(result.text).accessToken;
  else console.error(`could not sign in for ${variable}: ${result.status}`);
}

if (Object.keys(tokens).length < Object.keys(CREDS).length) {
  console.error('\nREFUSING TO REPORT: not every role could sign in, so a pass would be empty.\n');
  process.exit(2);
}

/* ── walk the collection ─────────────────────────────────────────────── */

const collection = JSON.parse(readFileSync(COLLECTION, 'utf8'));

function* walk(items, folder) {
  for (const item of items) {
    if (item.item) yield* walk(item.item, folder ?? item.name);
    else yield [folder, item];
  }
}

let checked = 0;
let skipped = 0;
const problems = [];

for (const [folder, item] of walk(collection.item)) {
  if (folder === '00 · Sign in') continue;
  const request = item.request;
  if (request.method !== 'GET') {
    skipped += 1;
    continue;
  }
  const path = `/${request.url.path.join('/')}`;
  if (path.includes('{') || path.includes(':')) {
    skipped += 1;
    continue;
  }

  const auth = (request.header ?? []).find((h) => h.key === 'Authorization');
  const variable = auth?.value.replace('Bearer {{', '').replace('}}', '') ?? null;
  const url = BASE + path;
  checked += 1;

  if (variable === null) {
    const bare = await call('GET', url, null);
    if (bare.status === 401 || bare.status === 403) {
      problems.push([folder, path, `documented PUBLIC but answered ${bare.status}`]);
    }
    continue;
  }

  const withToken = await call('GET', url, tokens[variable]);
  if (withToken.status === 401 || withToken.status === 403) {
    problems.push([folder, path, `documented for ${variable} but answered ${withToken.status}`]);
  }
  const bare = await call('GET', url, null);
  if (bare.status !== 401 && bare.status !== 403) {
    problems.push([folder, path, `documented as protected but answered ${bare.status} with NO token`]);
  }
}

console.log(`\nchecked ${checked} GET routes   (skipped ${skipped}: non-GET or path-parameter)\n`);
if (problems.length === 0) {
  console.log("every documented role matched the server's actual answer\n");
  process.exit(0);
}
console.error(`MISMATCHES: ${problems.length}\n`);
for (const [folder, path, why] of problems) {
  console.error(`  ${folder.padEnd(26)} ${path.padEnd(44)} ${why}`);
}
console.error('');
process.exit(1);
