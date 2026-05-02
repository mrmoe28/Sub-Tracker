# Sub-Tracker

Sub-Tracker is a Next.js app for finding forgotten subscriptions from bank
transactions. It connects to bank accounts through Plaid Sandbox, imports
transactions, detects recurring subscription-like charges, and helps track down
provider cancellation links through a reviewable search workflow.

## Features

- Google sign-in with Auth.js and Prisma-backed sessions
- Plaid Link bank connection flow
- Encrypted Plaid access-token storage using AES-256-GCM
- Cursor-based transaction import with Plaid `/transactions/sync`
- Plaid recurring-stream ingestion with `/transactions/recurring/get`
- Heuristic subscription detection from local transaction patterns
- Subscription review states: confirm, ignore, or mark canceled
- Merchant normalization and curated cancellation metadata
- Serper-powered cancellation-link discovery
- Review workflow for discovered cancellation links before they become trusted
- Dashboard, transactions, subscriptions, and settings views

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Prisma
- PostgreSQL
- Auth.js with Google OAuth
- Plaid Node SDK
- Serper API for merchant cancellation-link search

## How It Works

1. A user signs in with Google.
2. The user connects a bank through Plaid Link.
3. The server exchanges the Plaid `public_token` for an `access_token`.
4. The access token is encrypted before it is stored.
5. Transactions are imported with Plaid `/transactions/sync`.
6. Subscription candidates are created from Plaid recurring streams and local
   transaction heuristics.
7. The user reviews each candidate and can confirm, ignore, or mark it canceled.
8. For missing cancellation links, the app searches via Serper and saves
   unverified `CancellationCandidate` records.
9. The user approves a suggested link before it is copied to the merchant's
   trusted cancellation URL.

## Required Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/sub_tracker?schema=public"

TOKEN_ENCRYPTION_KEY=""
TOKEN_ENCRYPTION_KEY_VERSION=1

AUTH_SECRET=""
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""
AUTH_URL="http://localhost:3100"

PLAID_CLIENT_ID=""
PLAID_SECRET=""
PLAID_ENV=sandbox

SERPER_API_KEY=""
```

Generate a token encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Generate an Auth.js secret:

```bash
npx auth secret
```

For Google OAuth local development, use:

- Authorized JavaScript origin: `http://localhost:3100`
- Authorized redirect URI: `http://localhost:3100/api/auth/callback/google`

## Development

Install dependencies:

```bash
npm install
```

Apply migrations and seed curated merchants:

```bash
npm run db:migrate
```

Start the app:

```bash
npm run dev -- -p 3100
```

Open:

```text
http://localhost:3100
```

## Scripts

```bash
npm run dev        # Start Next.js dev server
npm run build      # Production build
npm run lint       # ESLint
npm run db:migrate # Apply local migrations
npm run db:deploy  # Apply production migrations
npm run db:seed    # Seed curated merchant data
npm run db:studio  # Open Prisma Studio
```

## Plaid Sandbox Notes

The app is intentionally gated to `PLAID_ENV=sandbox` while the integration is
being built and audited.

Common Plaid Sandbox test credentials:

```text
username: user_good
password: pass_good
```

The Plaid phone-number step is optional. For Sandbox testing, choose
`Continue without phone number` if Plaid rejects a phone number.

## Cancellation Link Safety

Search results are not treated as verified. The app stores discovered links as
pending cancellation candidates. A user must approve a candidate before it
becomes the merchant's trusted cancellation URL.

This avoids presenting guessed or low-confidence links as official cancellation
paths.

## Production Gaps

Before using real financial data outside Sandbox:

- Add Plaid webhook handling and verification.
- Add production-grade monitoring and alerting.
- Review logging for sensitive data.
- Add account deletion and data export flows.
- Add rate limits for mutation/search endpoints.
- Move from Plaid Sandbox to the appropriate Plaid production environment only
  after approval and security review.
