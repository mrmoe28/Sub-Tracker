# Chrome and email connections

Implemented on Master, 2026-10-30. This is connection infrastructure, not a claim of completed real-merchant cancellation.

## Chrome Connect 0.3.0

Missing-domain recovery now runs website search and read-only receipt lookup instead of stopping at the missing field. Results are suggestions, not verified providers. The user chooses a website with a signed, expiring selection bound to their subscription and user. The choice is stored on that user's subscription, not the shared merchant. Search-discovered cancellation pages remain pending review.

The browser target also recognizes an existing HTTPS merchant website or the owner's saved login URL. Exact host boundaries are preserved when storing and loading new sessions, including sites on shared hosting domains. No sibling-domain cookies are requested.

If Chrome has no usable session, the row offers Open Chrome sign-in and Continue from Chrome. The extension opens or focuses the chosen provider in the existing Chrome profile. Chrome, not Sub-Tracker, handles saved-password autofill and authentication prompts. Continue imports that site's session and resumes the cancellation finder. Provider authentication and final cancellation approval can still require the user.

The signed-in Sub-Tracker page communicates with an isolated content script on `https://sub.lock28.com` only. The worker accepts messages only from that origin's tabs. For an owned subscription with a known merchant domain, it locates an HTTPS tab with that domain or a subdomain and reads cookies from that tab's cookie store. Cookies go directly from the isolated script to the authenticated, same-origin session endpoint; the page message receives only success or an error. No pairing token is needed for this path. Existing manual pairing remains as a fallback.

The import endpoint checks subscription ownership, site/domain agreement, and cookie domains before encrypted storage. A cookie is not proof of a logged-in account; the existing cancellation finder must still establish access. No merchant-domain matching from arbitrary email links is performed.

Cancel for me is available for pending/confirmed subscriptions without a saved login. Missing sessions trigger Chrome discovery and then an email receipt search if Chrome discovery fails. Existing cancellation approval and screenshot-proof gates remain unchanged.

When no merchant tab is open, the worker uses the Sub-Tracker tab's Chrome cookie store and requests only the exact known merchant domain's cookies. This discovers saved site sessions without opening merchant tabs. A matching open tab takes precedence, including its cookie store.

Limitations: the cancellation walker runs in the app browser, not the everyday Chrome tab. This version does not read Google's password vault or force autofill. Receipt sender matches do not prove the billing provider. Imported sessions can fail on device-bound authentication. Real-merchant acceptance still requires a successful authenticated cancellation and proof; passing fixtures does not establish that.

## Gmail

Settings connects each mailbox with separate read-only OAuth consent, PKCE, ten-minute HttpOnly state cookie bound to the signed-in Sub-Tracker user, and encrypted refresh tokens. It does not expand the normal application sign-in scopes. Receipt searches retrieve only sender, subject, and date metadata; Gmail's read-only scope is needed for its search query feature. No send/modify/delete API is used. Message text is never treated as automation instructions.

The OAuth client must allow `https://sub.lock28.com/api/email/callback`; Gmail API must be enabled. Both were configured in the Sub Tracker Google Cloud project. User consent and any Google test-user/verification restrictions remain external requirements. Metadata matches are evidence for review, not proof of a specific subscription or authorization to cancel.

## Verification

- TypeScript, ESLint, production build and existing 28 unit tests passed.
- Existing Chromium cancellation scenarios passed: explicit proof, ambiguous proof, saved session, and 2FA.
- Seven worker tests cover trusted-origin enforcement, matching cookie store, lookalike/insecure sites, invalid requests, and opening/focusing native Chrome sign-in.
- Actual Chromium extension fixture passed: matching merchant tab, authenticated same-origin session POST, and no cookies in page messages.
- Mocked Gmail tests passed: ownership, encrypted refresh-token retrieval, metadata-only search, and revoked consent.
- Fixtures use synthetic credentials. Live email consent, live receipt lookup, and real-merchant cancellation are not established by these tests.

The account-discovery fixture additionally checks missing-domain resolution, user-bound and expiring website selections, tamper rejection, and exact-host session storage. `npm run test:account-ui` (after a production build for CSS) renders the real row component in Chromium at desktop and mobile widths, selects a suggested website, opens native Chrome, imports a synthetic session, and verifies that final cancellation waits for explicit approval.
