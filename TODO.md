# Plaid Webhooks Implementation

- [x] Read all existing Plaid routes and sync logic
- [x] Research Plaid webhook docs (verification, types, IPs, retries)
- [x] Create `src/app/api/plaid/webhook/route.ts` — webhook receiver
- [x] Update `create-link-token` to pass `webhook` URL when configured
- [x] Add `PLAID_WEBHOOK_URL` to `.env.example`
- [x] Update `DEV.md` with webhook setup + testing instructions
- [x] Add `plaidWebhookUrl` to `getServerEnv()`
- [x] Fix `next/request` → `next/server` import typo
- [x] Run `npx tsc --noEmit` — clean
