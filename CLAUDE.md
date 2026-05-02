# Project Instructions

This is a Next.js App Router subscription tracker using Plaid and Google OAuth.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma
- PostgreSQL
- Auth.js with Google OAuth
- Plaid Node SDK

## Security Rules

- Never expose Plaid access tokens to the browser.
- Store Plaid access tokens encrypted at rest.
- Use `getCurrentUser()` for user-scoped data access.
- Every user-owned Prisma query must filter by authenticated `userId`.
- Do not log Plaid request configs, headers, request bodies, or access tokens.
- Use `/transactions/sync`, not `/transactions/get`.
- Keep Plaid recurring streams separate from our own subscription classification.
- Do not fabricate cancellation URLs.
- Search-discovered cancellation URLs must stay as `CancellationCandidate`
  rows until the user approves them.

## Local Auth Setup

- Google OAuth callback URL: `http://localhost:3000/api/auth/callback/google`
- Required env vars: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
  `AUTH_URL`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, Plaid sandbox vars.

## UX Rules

- Build the actual app, not a marketing page.
- Keep the dashboard utilitarian and data-focused.
- Mark uncertain subscription detections as "needs review".
