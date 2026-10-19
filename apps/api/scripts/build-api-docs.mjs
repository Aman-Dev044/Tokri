#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE API REFERENCE, REGENERATED FROM THE API
 * ════════════════════════════════════════════════════════════════════════
 *
 *   pnpm --filter @mandi/api docs:api        (API must be running)
 *
 * Writes two files into `docs/`:
 *
 *   · API.md                            — a reference to read
 *   · tokri-api.postman_collection.json  — a collection to run
 *
 * Both come from the same two sources, so they cannot disagree with each
 * other or drift from the service:
 *
 *   1. the OpenAPI document the RUNNING api serves at `/docs-json`
 *      — paths, verbs, query parameters, request schemas, summaries
 *   2. the controllers on disk
 *      — `@Roles()` and `@Public()`, i.e. WHO IS ALLOWED IN
 *
 * ── Why the second source exists ────────────────────────────────────────
 * Authorisation is the half Swagger cannot see. `@Roles()` and `@Public()`
 * are Nest decorators that `SwaggerModule` has no reason to read, so a
 * reference generated from the spec alone would present a deny-by-default
 * API as though every endpoint were open to anyone — the single most
 * misleading thing an API document can say.
 *
 * ── Why this is a script and not a one-off ──────────────────────────────
 * A reference written by hand is wrong the first time somebody adds an
 * endpoint and does not think of it. This one is wrong only if the service
 * is wrong, and `pnpm docs:api` is the whole update.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'apps', 'api', 'src');
const DOCS = join(ROOT, 'docs');
const BASE = process.env.DOCS_API_URL ?? 'http://localhost:4000/api/v1';

const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

/* ────────────────────────────── 1. the spec ────────────────────────── */

async function loadSpec() {
  const url = `${BASE}/docs-json`;
  const res = await fetch(url).catch(() => null);
  if (res === null || !res.ok) {
    console.error(
      `\nCould not read the OpenAPI document at ${url}.\n` +
        'Start the API first (pnpm --filter @mandi/api start:prod), or point\n' +
        'DOCS_API_URL at a running instance.\n',
    );
    process.exit(1);
  }
  return res.json();
}

/* ─────────────────────── 2. who is allowed in ──────────────────────── */

/** Blank comment bodies, keeping newlines, so nothing in prose is parsed. */
const decomment = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

const tidy = (path) => `/${path.split('/').filter(Boolean).join('/')}` || '/';

/** `{id}` and `:id` are the same route; compare on a common shape. */
const shape = (path) =>
  path.replace('/api/v1', '').replace(/\{[^}]+\}|:[A-Za-z_]\w*/g, '*');

function readRoles() {
  // Not just `*.controller.ts`: the health probes live inside
  // `health.module.ts`, and globbing on the filename alone silently dropped
  // the two endpoints every uptime check depends on.
  const files = globSync('**/*.ts', { cwd: SRC })
    .map((f) => join(SRC, f))
    .filter((f) => readFileSync(f, 'utf8').includes('@Controller('));

  const out = new Map();

  for (const file of files) {
    const src = decomment(readFileSync(file, 'utf8'));
    const controllerAt = src.search(/@Controller\(/);
    const base = /@Controller\(\s*'([^']*)'\s*\)/.exec(src)?.[1] ?? '';

    // The class-level decorators are the ones above the CONTROLLER class,
    // which is not necessarily the first `export class` in the file. Several
    // controllers declare their DTOs above themselves — `orders.controller`
    // opens with `export class CancelOrderDto` — and cutting at the first
    // match put the controller's own `@Roles(Role.CUSTOMER)` outside the
    // header, so every route in it was documented as open to any signed-in
    // user instead of to customers.
    const classAt = controllerAt === -1 ? -1 : src.indexOf('export class', controllerAt);
    const head = classAt === -1 ? '' : src.slice(0, classAt);

    const rolesIn = (text) => {
      const blocks = [...text.matchAll(/@Roles\(([^)]*)\)/g)].map((m) => m[1]);
      // Joined with a comma, not concatenated: `Role.SUPER_ADMIN` followed
      // straight by `Role.ADMIN` reads as one token called SUPER_ADMINR.
      return [...new Set([...blocks.join(',').matchAll(/Role\.([A-Z_]+)/g)].map((m) => m[1]))];
    };

    const classRoles = rolesIn(head);
    const classPublic = head.includes('@Public()');

    const hits = [...src.matchAll(new RegExp(`@(${VERBS.map((v) => v[0].toUpperCase() + v.slice(1)).join('|')})\\(\\s*(?:'([^']*)')?\\s*\\)`, 'g'))];

    // A route's decorators are the CONTIGUOUS run of `@…` lines around its
    // verb decorator — walk up while lines start with `@`, then down.
    //
    // Slicing "from the previous route to this one" instead reaches across
    // the gap into the NEXT route's decorators, and that is not theoretical:
    // `@Get('me')` sits directly above `@Public() @Post('register/...')`, so
    // it inherited that `@Public()` and the reference told readers an
    // authenticated endpoint needed no token. The live check caught it.
    const lines = src.split('\n');
    const lineStart = [];
    let offset = 0;
    for (const line of lines) {
      lineStart.push(offset);
      offset += line.length + 1;
    }
    const lineOf = (index) => {
      let low = 0;
      let high = lineStart.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStart[mid] <= index) low = mid;
        else high = mid - 1;
      }
      return low;
    };
    const isDecorator = (n) => n >= 0 && n < lines.length && lines[n].trim().startsWith('@');

    hits.forEach((hit, i) => {
      void i;
      const verb = hit[1].toUpperCase();
      const sub = hit[2] ?? '';
      const at = lineOf(hit.index);
      let top = at;
      while (isDecorator(top - 1)) top -= 1;
      let bottom = at;
      while (isDecorator(bottom + 1)) bottom += 1;
      const scope = lines.slice(top, bottom + 1).join('\n');

      const roles = rolesIn(scope);
      const path = tidy(`${base}/${sub}`);
      const key = `${verb} ${shape(path)}`;
      const entry = {
        public: scope.includes('@Public()') || (classPublic && roles.length === 0),
        roles: roles.length > 0 ? roles : classRoles,
        file: relative(ROOT, file).split(sep).join('/'),
        path,
      };

      // The map is keyed on the SHAPED path so it can be looked up from the
      // OpenAPI document, which writes `{id}` where the source writes `:id`.
      // That collapse is only safe while two different routes never land on
      // the same key — and if they ever do, the second silently overwrites
      // the first and the document starts attributing one route's roles to
      // another. Since this file publishes a security claim, a collision
      // with DIFFERENT roles stops the build instead of being averaged away.
      const existing = out.get(key);
      if (existing !== undefined) {
        const same =
          existing.public === entry.public &&
          existing.roles.slice().sort().join() === entry.roles.slice().sort().join();
        if (!same) {
          console.error(
            `\nTwo routes collapse to "${key}" with DIFFERENT access rules:\n` +
              `  ${existing.path}  ${existing.public ? 'public' : existing.roles.join('/')}  (${existing.file})\n` +
              `  ${entry.path}  ${entry.public ? 'public' : entry.roles.join('/')}  (${entry.file})\n` +
              'One of them would be documented with the other\'s permissions.\n',
          );
          process.exit(1);
        }
      }
      out.set(key, entry);
    });
  }
  return out;
}

/* ───────────────────────── 3. shared shaping ───────────────────────── */

const SECTIONS = [
  ['PUBLIC', 'Public', 'No token at all. The only routes reachable signed out.'],
  ['CUSTOMER', 'Customer', 'Token with role `customer`.'],
  [
    'VENDOR',
    'Vendor',
    "Token with role `vendor`. Also scoped to the caller's own shop by `VendorScopeGuard` — a vendor cannot reach another vendor's data by changing an id.",
  ],
  [
    'DELIVERY',
    'Rider',
    'Token with role `delivery`. Taking work additionally needs verified KYC (`403 KYC_NOT_VERIFIED`) and a wallet balance above the pick fee (`402 INSUFFICIENT_WALLET_BALANCE`).',
  ],
  ['ADMIN', 'Admin', 'Token with role `admin` or `super_admin`.'],
  ['SUPER_ADMIN', 'Super Admin', 'Token with role `super_admin` only.'],
  ['ANY', 'Any signed-in user', 'Any valid token; no role restriction. Still not public.'],
];

const ORDER = ['CUSTOMER', 'VENDOR', 'DELIVERY', 'ADMIN', 'SUPER_ADMIN'];

function sectionFor(info) {
  if (!info) return 'ANY';
  if (info.public) return 'PUBLIC';
  // A route open to several roles is filed under the LEAST privileged one
  // that can call it — which is where somebody would look for it.
  return ORDER.find((role) => info.roles.includes(role)) ?? 'ANY';
}

const TOKEN_VAR = {
  PUBLIC: null,
  CUSTOMER: 'customerToken',
  VENDOR: 'vendorToken',
  DELIVERY: 'riderToken',
  ADMIN: 'adminToken',
  SUPER_ADMIN: 'superAdminToken',
  ANY: 'customerToken',
};

/** A plausible example value for a schema, resolving $ref. */
function exampleFor(schema, schemas, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return undefined;
  if (schema.$ref) {
    return exampleFor(schemas[schema.$ref.split('/').pop()], schemas, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (schema.type === 'object' || schema.properties) {
    const out = {};
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      const value = exampleFor(sub, schemas, depth + 1);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (schema.type === 'array') {
    const item = exampleFor(schema.items ?? {}, schemas, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'string') {
    return schema.format === 'date-time' ? '2026-10-19T09:00:00.000Z' : '';
  }
  return undefined;
}

/* ─────────────────────────── 4. the outputs ────────────────────────── */

const SIGN_INS = [
  ['Super Admin', 'superadmin@tokri.app', '***REMOVED***', 'superAdminToken'],
  ['Admin', 'admin@tokri.app', '***REMOVED***', 'adminToken'],
  ['Vendor', 'vendor@grocery.in', '***REMOVED***', 'vendorToken'],
  ['Customer', 'customer@grocery.in', '***REMOVED***', 'customerToken'],
  ['Rider', 'delivery@grocery.in', '***REMOVED***', 'riderToken'],
];

function groupFor(path) {
  const parts = path.replace('/api/v1', '').split('/').filter((p) => p && !p.startsWith('{'));
  if (parts.length === 0) return 'root';
  if (['admin', 'vendor', 'delivery'].includes(parts[0]) && parts.length > 1) return parts[1];
  return parts[0];
}

function buildCollection(spec, roles, rows, publicCount, total) {
  const schemas = spec.components?.schemas ?? {};
  const folders = new Map();

  for (const { verb, path, op, info, key } of rows) {
    const section = sectionFor(info);
    const label = `${String(SECTIONS.findIndex((s) => s[0] === section) + 1).padStart(2, '0')} · ${SECTIONS.find((s) => s[0] === section)[1]}`;
    if (!folders.has(label)) folders.set(label, { section, groups: new Map() });
    const bucket = folders.get(label);
    const group = groupFor(path);
    if (!bucket.groups.has(group)) bucket.groups.set(group, []);

    const query = [];
    const variable = [];
    for (const param of op.parameters ?? []) {
      if (param.in === 'query') {
        const value = exampleFor(param.schema ?? {}, schemas);
        query.push({
          key: param.name,
          value: value === undefined ? '' : String(value),
          description: param.description ?? '',
          disabled: param.required !== true,
        });
      } else if (param.in === 'path') {
        variable.push({ key: param.name, value: '', description: param.description || 'required' });
      }
    }

    const header = [];
    const tokenVar = TOKEN_VAR[section];
    if (tokenVar) header.push({ key: 'Authorization', value: `Bearer {{${tokenVar}}}` });

    let body;
    const json = op.requestBody?.content?.['application/json'];
    if (json) {
      const sample = exampleFor(json.schema ?? {}, schemas);
      if (sample !== undefined) {
        header.push({ key: 'Content-Type', value: 'application/json' });
        body = {
          mode: 'raw',
          raw: JSON.stringify(sample, null, 2),
          options: { raw: { language: 'json' } },
        };
      }
    }

    const notes = [];
    if (op.summary) notes.push(op.summary);
    if (op.description && op.description !== op.summary) notes.push('', op.description);
    notes.push('');
    if (!info || info.public) notes.push('**Auth** — none. This route is `@Public()`.');
    else if (info.roles.length > 0) {
      notes.push(`**Auth** — bearer token, role must be ${info.roles.map((r) => `\`${r.toLowerCase()}\``).join(', ')}.`);
    } else notes.push('**Auth** — bearer token; any role.');
    const codes = Object.keys(op.responses ?? {}).sort();
    if (codes.length > 0) notes.push('', `**Responses** — ${codes.map((c) => `\`${c}\``).join(', ')}`);

    const request = {
      method: verb,
      header,
      url: {
        raw: `{{baseUrl}}${path}`,
        host: ['{{baseUrl}}'],
        path: path.split('/').filter(Boolean),
        ...(query.length > 0 ? { query } : {}),
        ...(variable.length > 0 ? { variable } : {}),
      },
      description: notes.join('\n').trim(),
    };
    if (body) request.body = body;

    bucket.groups.get(group).push({ name: op.summary || `${verb} ${path}`, request, response: [] });
    void key;
  }

  const signIn = SIGN_INS.map(([label, identifier, password, variable]) => ({
    name: `Sign in as ${label}`,
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            `// Saves the token so every ${label.toLowerCase()} request below just works.`,
            'const body = pm.response.json();',
            'if (body.accessToken) {',
            `  pm.collectionVariables.set('${variable}', body.accessToken);`,
            "  pm.test('token saved', () => pm.expect(body.accessToken).to.be.a('string'));",
            '}',
          ],
        },
      },
    ],
    request: {
      method: 'POST',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      url: { raw: '{{baseUrl}}/auth/login', host: ['{{baseUrl}}'], path: ['auth', 'login'] },
      body: {
        mode: 'raw',
        raw: JSON.stringify({ identifier, password }, null, 2),
        options: { raw: { language: 'json' } },
      },
      description:
        `Signs in and **saves the token** into \`{{${variable}}}\`.\n\n` +
        '`identifier` takes an email OR a 10-digit phone number.\n\n' +
        'Rate limited to `THROTTLE_AUTH_LIMIT` attempts per minute per IP — ' +
        'budget one login per role.',
    },
    response: [],
  }));

  const items = [
    {
      name: '00 · Sign in',
      description:
        'Run one of these first. Each saves its token into a collection ' +
        'variable that the matching role folder already references.',
      item: signIn,
    },
  ];

  for (const [label, bucket] of [...folders.entries()].sort()) {
    const sub = [...bucket.groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, requests]) => ({
        name,
        item: requests.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      }));
    items.push({
      name: label,
      description: SECTIONS.find((s) => s[0] === bucket.section)[2],
      item: sub,
    });
  }

  return {
    info: {
      name: 'Tokri API',
      description: introduction(publicCount, total),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: BASE },
      { key: 'customerToken', value: '' },
      { key: 'vendorToken', value: '' },
      { key: 'riderToken', value: '' },
      { key: 'adminToken', value: '' },
      { key: 'superAdminToken', value: '' },
    ],
    item: items,
  };
}

const GUARD_CHAIN =
  'ThrottlerGuard -> JwtAuthGuard -> RolesGuard -> VendorScopeGuard -> ResourceOwnerGuard';

function introduction(publicCount, total) {
  return `# Tokri API

Multi-vendor grocery delivery. Every endpoint the service exposes, grouped
by **who is allowed to call it**.

## Start here

Open **00 · Sign in** and run the login for the role you want. Each one
saves its token into a collection variable, so the folders below work
immediately afterwards — no copying JWTs by hand.

## How authorisation works

The API is **deny by default**. A global guard chain runs on every request:

\`\`\`
${GUARD_CHAIN}
\`\`\`

A route is only reachable without a token if it is explicitly marked
\`@Public()\`, and there are ${publicCount} of those out of ${total}.

\`VendorScopeGuard\` is worth calling out: a vendor cannot reach another
vendor's data by changing an id in the URL. The scope comes from the token,
never from the request.

## Conventions

* **Money is always INTEGER PAISE.** ₹429 is \`42900\`.
* **Lists paginate** with \`?page=&limit=\` and answer
  \`{ data, meta: { page, limit, total, pages } }\`.
* **Errors are RFC 7807** problem documents, with a machine-readable
  \`errors.code\` where one exists.
* **Validation is strict.** An unknown query parameter or body field is a
  \`400\`, never a silent ignore.
`;
}

function buildMarkdown(spec, rows, publicCount, total) {
  const schemas = spec.components?.schemas ?? {};
  const buckets = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const row of rows) buckets.get(sectionFor(row.info)).push(row);

  const out = [
    '# Tokri API reference',
    '',
    `Every endpoint the service exposes — **${total}** of them — grouped by who may call it.`,
    '',
    'Generated by `pnpm --filter @mandi/api docs:api` from the OpenAPI document the',
    'running API serves, plus the `@Roles()` and `@Public()` decorators on the',
    'controllers. Swagger cannot see authorisation, so a reference built from the spec',
    'alone would describe a deny-by-default API as though every route were open.',
    '',
    'A runnable Postman collection of the same thing lives beside this file:',
    '[`tokri-api.postman_collection.json`](./tokri-api.postman_collection.json).',
    '',
    '## Authorisation',
    '',
    'Deny by default. A global guard chain runs on every request:',
    '',
    '```',
    GUARD_CHAIN,
    '```',
    '',
    `Only \`@Public()\` routes are reachable without a token, and there are **${publicCount}**`,
    'of them. Send the rest a bearer token:',
    '',
    '```http',
    'Authorization: Bearer <accessToken>',
    '```',
    '',
    '`POST /auth/login` takes `identifier` (email **or** 10-digit phone) and `password`,',
    'and answers `{ user, accessToken }`. The refresh token is set as an httpOnly cookie,',
    'rotates on every use, and reuse is detected — a captured cookie is good for exactly',
    'one refresh.',
    '',
    '## Conventions',
    '',
    '- **Money is INTEGER PAISE everywhere.** ₹429 is `42900`.',
    '- **Lists paginate** with `?page=&limit=` and answer `{ data, meta: { page, limit, total, pages } }`.',
    '- **Errors are RFC 7807** problem documents, with a machine-readable `errors.code` where one exists.',
    '- **Validation is strict**: an unknown query parameter or body field is a `400`, never a silent ignore.',
    '',
    '## Contents',
    '',
  ];

  for (const [key, title] of SECTIONS) {
    const rowsFor = buckets.get(key);
    if (rowsFor.length > 0) {
      out.push(`- [${title}](#${title.toLowerCase().replace(/ /g, '-')}) — ${rowsFor.length} endpoints`);
    }
  }

  for (const [key, title, note] of SECTIONS) {
    const rowsFor = buckets.get(key);
    if (rowsFor.length === 0) continue;
    out.push('', '---', '', `## ${title}`, '', note, '');

    for (const { verb, path, op, info } of rowsFor) {
      out.push(`### \`${verb} ${path}\``, '');
      if (op.summary) out.push(op.summary, '');
      if (op.description && op.description !== op.summary) out.push(op.description, '');
      if (info && !info.public && info.roles.length > 0) {
        out.push(`**Roles** — ${info.roles.map((r) => `\`${r.toLowerCase()}\``).join(', ')}`, '');
      }

      const query = (op.parameters ?? []).filter((p) => p.in === 'query');
      if (query.length > 0) {
        out.push('| Query | Type | Required |', '| --- | --- | --- |');
        for (const p of query) {
          const s = p.schema ?? {};
          const kind = Array.isArray(s.enum)
            ? s.enum.slice(0, 6).map((e) => `\`${e}\``).join(' \\| ')
            : (s.type ?? 'string');
          out.push(`| \`${p.name}\` | ${kind} | ${p.required ? 'yes' : ''} |`);
        }
        out.push('');
      }

      let schema = op.requestBody?.content?.['application/json']?.schema ?? {};
      if (schema.$ref) schema = schemas[schema.$ref.split('/').pop()] ?? {};
      const props = Object.entries(schema.properties ?? {});
      if (props.length > 0) {
        const required = new Set(schema.required ?? []);
        out.push('| Body | Type | Required | Notes |', '| --- | --- | --- | --- |');
        for (const [name, sub] of props) {
          const kind = Array.isArray(sub.enum)
            ? sub.enum.slice(0, 6).map((e) => `\`${e}\``).join(' \\| ')
            : sub.$ref
              ? sub.$ref.split('/').pop()
              : (sub.type ?? 'object');
          out.push(
            `| \`${name}\` | ${kind} | ${required.has(name) ? 'yes' : ''} | ${(sub.description ?? '').replace(/\n/g, ' ')} |`,
          );
        }
        out.push('');
      }

      const codes = Object.keys(op.responses ?? {}).sort();
      if (codes.length > 0) out.push(`**Responses** — ${codes.map((c) => `\`${c}\``).join(', ')}`, '');
    }
  }

  return `${out.join('\n')}\n`;
}

/* ──────────────────────────────── run ──────────────────────────────── */

const spec = await loadSpec();
const roles = readRoles();

const rows = [];
for (const [rawPath, ops] of Object.entries(spec.paths).sort()) {
  for (const [verbLower, op] of Object.entries(ops).sort()) {
    if (!VERBS.includes(verbLower)) continue;
    const verb = verbLower.toUpperCase();
    const path = rawPath.replace('/api/v1', '');
    const key = `${verb} ${shape(rawPath)}`;
    rows.push({ verb, path, op, info: roles.get(key), key });
  }
}

const missing = rows.filter((r) => r.info === undefined);
if (missing.length > 0) {
  // Loud on purpose: an endpoint whose roles could not be read would be
  // documented as "any signed-in user", which is a security claim.
  console.error(`\n${missing.length} route(s) had no role information:`);
  for (const r of missing) console.error(`  ${r.verb} ${r.path}`);
  console.error('Fix the extractor before trusting the output.\n');
  process.exit(1);
}

const publicCount = rows.filter((r) => r.info.public).length;
const total = rows.length;

mkdirSync(DOCS, { recursive: true });
writeFileSync(
  join(DOCS, 'tokri-api.postman_collection.json'),
  `${JSON.stringify(buildCollection(spec, roles, rows, publicCount, total), null, 2)}\n`,
);
writeFileSync(join(DOCS, 'API.md'), buildMarkdown(spec, rows, publicCount, total));

const tally = {};
for (const row of rows) {
  const name = SECTIONS.find((s) => s[0] === sectionFor(row.info))[1];
  tally[name] = (tally[name] ?? 0) + 1;
}
console.log(`\n${total} endpoints documented into ${relative(ROOT, DOCS)}/\n`);
for (const [name, n] of Object.entries(tally)) console.log(`  ${name.padEnd(22)} ${n}`);
console.log(`\n  ${String(publicCount).padStart(3)} reachable without a token\n`);
void dirname;
