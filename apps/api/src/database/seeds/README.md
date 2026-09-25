# Database seeds

Creates the two bootstrap platform accounts — one `SUPER_ADMIN`, one
`ADMIN` — so that a fresh database has someone who can log in.

Nothing else is seeded. Vendors, products and orders are created through
the API, not from here.

## Prerequisites

1. **MongoDB (Atlas).** `MONGO_URI` / `MONGO_DB_NAME` in `apps/api/.env`
   point at the Atlas cluster. Atlas clusters are replica sets, so the
   multi-document transactions the checkout stock-reservation depends on
   work out of the box.

   **Atlas Network Access.** Atlas rejects connections from unlisted
   addresses. If the seed fails with a server-selection timeout, add this
   machine's public IP under *Atlas → Network Access → IP Access List*.
   That is almost always the cause — it is not a bug in the seed.

2. **Redis** (`docker compose -f docker/docker-compose.yml up -d redis`)
   is required by the API, but not by the seed itself.

3. `pnpm install` has been run at the repo root.

## Running it

From the repo root:

```bash
pnpm --filter @mandi/api seed
```

or from `apps/api`:

```bash
pnpm seed
```

It is **idempotent**. A second run reports `already exists, skipped` and
changes nothing, so it is safe in a bootstrap script or a CI step.

Output is email, role and outcome only:

```
Seed complete:
  SUPER_ADMIN  <email from .env>              created
  ADMIN        <email from .env>              created
```

**Passwords are never printed.** They live in `.env` and nowhere else —
not in this repo, not in the log, not in CI output.

## Changing the credentials

The credentials are configuration, not code. There is nothing to edit in
any `.ts` file.

1. Edit the `SEED_*` block in `apps/api/.env`:

   ```
   SEED_SUPERADMIN_NAME=
   SEED_SUPERADMIN_EMAIL=
   SEED_SUPERADMIN_PHONE=      # exactly 10 digits
   SEED_SUPERADMIN_PASSWORD=   # minimum 12 characters

   SEED_ADMIN_NAME=
   SEED_ADMIN_EMAIL=
   SEED_ADMIN_PHONE=
   SEED_ADMIN_PASSWORD=
   ```

2. Re-run with `--force`:

   ```bash
   pnpm --filter @mandi/api seed -- --force
   # or:  SEED_FORCE=true pnpm --filter @mandi/api seed
   ```

`--force` resets the two system accounts' passwords to the current `.env`
values and revokes their refresh-token families, so any session opened
with the old password stops working. It still prints nothing secret.

This is also the recovery path when someone forgets the admin password:
set a new one in `.env`, re-run with `--force`.

The values are validated by the same Joi schema the application boots
with (`src/config/env.validation.ts`). A password shorter than 12
characters, a phone that is not 10 digits, or a missing variable aborts
the run — it will not quietly create a weak account.

## Production safety

The seeder refuses to run when `NODE_ENV=production` unless
`SEED_ALLOW_PRODUCTION=true` is explicitly set. Seeding a live database
with credentials from a developer's local `.env` is how a known-password
administrator ends up on a production platform.

> **Change these passwords before any non-local deployment.**
> The values in the committed `.env.example` are placeholders, and the
> values in a local `.env` have been on a developer machine. Treat both as
> compromised for anything beyond localhost. Generate fresh ones, set them
> in the deployment environment, and run the seed once with `--force`.

## Files

| File | Role |
| --- | --- |
| `seed.ts` | CLI entry point. Flag parsing, production guard, exit codes. |
| `seed.module.ts` | Standalone Nest module: validated config + Mongoose + `PasswordService`. |
| `seed-users.ts` | The idempotent upsert logic for the two accounts. |

The seeder boots a Nest **application context** rather than re-implementing
anything, which is what guarantees the seeded hashes match what
`/auth/login` verifies: same `PasswordService`, same argon2id parameters,
same `ARGON2_PEPPER`. A hand-rolled hash here would produce accounts that
exist but can never sign in.

Exit code is `0` on success and `1` on any failure.
