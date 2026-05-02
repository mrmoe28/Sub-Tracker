# Sub-Tracker — Dev guide

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Prisma 6 · PostgreSQL.

## First-time setup

1. Copy env: `cp .env.example .env`
2. Fill in `DATABASE_URL` (any Postgres 14+).
3. Generate a token encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Put it in `TOKEN_ENCRYPTION_KEY`. Leave `TOKEN_ENCRYPTION_KEY_VERSION=1` for now.
4. Run migrations and seed:
   ```bash
   npm run db:migrate    # applies prisma/migrations/* and runs seed
   ```
5. Start the app:
   ```bash
   npm run dev
   ```

## Scripts

| Script           | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `npm run dev`    | Next.js dev server                                     |
| `npm run build`  | Production build                                       |
| `npm run lint`   | ESLint                                                 |
| `npm run db:migrate` | `prisma migrate dev` — applies pending migrations and re-seeds |
| `npm run db:deploy`  | `prisma migrate deploy` — for prod / CI                  |
| `npm run db:reset`   | Drop, re-create, re-migrate, re-seed                     |
| `npm run db:seed`    | Run `prisma/seed.ts` only                                |
| `npm run db:studio`  | Prisma Studio                                            |

## Data model

Two-layer recurring detection:

- **`RecurringStream`** — what Plaid says is recurring. Mirror of
  `/transactions/recurring/get`: `frequency`, `status`, `confidence`,
  `predictedNextDate`, plus the full Plaid object in `raw`.
- **`SubscriptionCandidate`** — our app's classification. May be derived
  from a `RecurringStream` (`source = PLAID_STREAM`), from our own
  heuristics on transactions (`source = HEURISTIC`), or added by the user
  (`source = USER`). The user makes a `UserSubscriptionDecision`
  (`KEEP` / `CANCEL_REQUESTED` / `CANCELED` / `IGNORE` / `SNOOZE`) per
  candidate.

Other models:
- `User`, `PlaidItem`, `PlaidAccount` — auth + linked institutions.
- `Transaction` — Plaid transaction with `pfcPrimary`/`pfcDetailed`
  flattened for indexing, full Plaid payload preserved in `raw`.
- `Merchant` — canonical name we de-dupe to.
- `CancellationLink` — vendor-specific cancel URL/instructions per merchant.

## Plaid token encryption

Access tokens are NEVER stored in plaintext. `PlaidItem` stores:
- `accessTokenCiphertext` (`Bytes`)
- `accessTokenIv` (`Bytes`, 12-byte GCM nonce)
- `accessTokenAuthTag` (`Bytes`, 16-byte GCM tag)
- `encryptionKeyVersion` (`Int`)

Use `src/lib/token-encryption.ts`:

```ts
import { encryptToken, decryptToken } from "@/lib/token-encryption";

// On Plaid /item/public_token/exchange:
const enc = encryptToken(accessToken);
await prisma.plaidItem.create({
  data: {
    userId,
    plaidItemId,
    accessTokenCiphertext: enc.ciphertext,
    accessTokenIv: enc.iv,
    accessTokenAuthTag: enc.authTag,
    encryptionKeyVersion: enc.keyVersion,
  },
});

// On any Plaid call:
const item = await prisma.plaidItem.findUniqueOrThrow({ where: { id } });
const accessToken = decryptToken(item);
```

### Key rotation
1. Generate a new key, set `TOKEN_ENCRYPTION_KEY` to it and bump
   `TOKEN_ENCRYPTION_KEY_VERSION` to e.g. `2`.
2. Keep the old key available (e.g. `TOKEN_ENCRYPTION_KEY_V1`) and
   extend `loadKey()` to look it up by version.
3. Run a re-encrypt job that decrypts each `PlaidItem` with the old key
   and writes back ciphertext/iv/authTag/version under the new key.

## Security gaps to close before production

These are KNOWN gaps. The app is not safe to deploy to a multi-user
environment until they are addressed.

### 1. Real auth (CRITICAL)

`src/lib/current-user.ts` is a stub that returns the same demo user for
every request. Every API route currently filters Prisma queries by
`userId` correctly — the structure is right — but until real auth is
wired, the filter resolves to a single shared identity.

- The stub fails-closed in production unless `ALLOW_DEMO_USER=true` is
  explicitly set, so it can't accidentally ship to prod.
- Replace `getCurrentUser()` with real session lookup (NextAuth, Clerk,
  custom JWT, etc.) and have it return 401 on missing/invalid sessions.
- Once real cookie-based sessions exist, the same-origin check in
  `src/lib/origin-check.ts` becomes effective CSRF protection.

### 2. Plaid webhooks (not implemented)

There is no webhook handler. When you add one
(`src/app/api/plaid/webhook/route.ts`):

- Verify the JWT signature on every webhook using
  `plaid.webhookVerificationKeyGet({ key_id })` and the `Plaid-Verification`
  header. **Don't trust the body until the signature verifies.**
- Deduplicate by `webhook_code` + `item_id` (and the per-event id where
  available). Plaid retries on 5xx; idempotent processing is required.
- The handler should look up the `PlaidItem` by `plaidItemId`, then call
  `syncPlaidItemTransactions(plaidItem.id, plaidItem.userId)` — the sync
  function now requires `userId` so the access token can only be loaded
  for the matching user.

### 3. What is already in place

- Plaid access tokens stored encrypted (AES-256-GCM, see above) and
  decrypted only in-process.
- Errors from Plaid are sanitized before logging — `console.error(err)`
  on an axios error would dump `PLAID-SECRET` and the request body
  (which on `/transactions/sync` includes the access token). All API
  routes go through `src/lib/safe-error.ts` which strips
  `err.config` / `err.request` and returns a generic message to the
  client.
- All `POST` routes apply a same-origin check
  (`src/lib/origin-check.ts`) — this is defense-in-depth that becomes
  meaningful CSRF protection once real session cookies land.
- `syncPlaidItemTransactions` and `syncRecurringStreams` both take
  `userId` and scope the `findFirstOrThrow` lookup, so even a future
  caller that forgets to filter at the route layer can't decrypt
  another user's token.
- Server-rendered pages use explicit `select` for `PlaidItem` and
  `Transaction` so `accessTokenCiphertext` / `transactionsCursor` /
  `Transaction.raw` never enter RSC scope.

## Migrations

`prisma/migrations/20260501000000_init/migration.sql` is the baseline.
Generate future migrations with:

```bash
npm run db:migrate -- --name <change_name>
```

Never edit applied migrations — add a new one.
