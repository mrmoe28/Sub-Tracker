# Chrome and email connections

Implemented on Master, 2026-10-30. This is connection infrastructure, not a claim of completed real-merchant cancellation.

## Chrome Connect 0.2

The signed-in Sub-Tracker page communicates with an isolated content script on `https://sub.lock28.com` only. The worker accepts messages only from that origin's tabs. For an owned subscription with a known merchant domain, it locates an HTTPS tab with that domain or a subdomain and reads cookies from that tab's cookie store. Cookies go directly from the isolated script to the authenticated, same-origin session endpoint; the page message receives only success or an error. No pairing token is needed for this path. Existing manual pairing remains as a fallback.

The import endpoint checks subscription ownership, site/domain agreement, and cookie domains before encrypted storage. A cookie is not proof of a logged-in account; the existing cancellation finder must still establish access. No merchant-domain matching from arbitrary email links is performed.

Cancel for me is available for pending/confirmed subscriptions without a saved login. Missing sessions trigger Chrome discovery and then an email receipt search if Chrome discovery fails. Existing cancellation approval and screenshot-proof gates remain unchanged.

Limitations: Chrome must have the merchant tab open; this version does not control the live Chrome cancellation flow, read Google's password vault, trigger autofill, resolve incorrect merchant domains, or automatically derive the billing provider from receipt content. Imported sessions can fail on device-bound authentication. These are still required for the broader autonomous-agent acceptance criteria.

## Gmail

Settings connects each mailbox with separate read-only OAuth consent, PKCE, ten-minute HttpOnly state cookie bound to the signed-in Sub-Tracker user, and encrypted refresh tokens. It does not expand the normal application sign-in scopes. Receipt searches retrieve only sender, subject, and date metadata; Gmail's read-only scope is needed for its search query feature. No send/modify/delete API is used. Message text is never treated as automation instructions.

The OAuth client must allow `https://sub.lock28.com/api/email/callback`; Gmail API must be enabled. Both were configured in the Sub Tracker Google Cloud project. User consent and any Google test-user/verification restrictions remain external requirements. Metadata matches are evidence for review, not proof of a specific subscription or authorization to cancel.

## Verification

- TypeScript, ESLint, production build and existing 28 unit tests passed.
- Existing Chromium cancellation scenarios passed: explicit proof, ambiguous proof, saved session, and 2FA.
- Four worker tests cover trusted-origin enforcement, matching cookie store, lookalike/insecure sites, and invalid requests.
- Actual Chromium extension fixture passed: matching merchant tab, authenticated same-origin session POST, and no cookies in page messages.
- Mocked Gmail tests passed: ownership, encrypted refresh-token retrieval, metadata-only search, and revoked consent.
- Fixtures use synthetic credentials. Live email consent, live receipt lookup, and real-merchant cancellation are not established by these tests.
