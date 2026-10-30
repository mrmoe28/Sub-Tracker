# Cancellation agent verification

Execution host: Master. These results cover the local working tree, not the deployed site.

## Behavior

- Cancel for me reuses a saved merchant session or encrypted login.
- Verification codes are entered in the app. Incorrect codes leave the attempt waiting.
- Cancellation links and buttons require approval. Duplicate approval requests claim the waiting attempt once.
- A new explicit confirmation and a captured screenshot are required before the agent records cancellation. The proof and subscription decision are saved together in a database transaction.
- Stopping a completed attempt does not overwrite its result. A browser lost during a waiting step requires a new attempt.
- Lapsed rows are hidden by default and can be shown with Show lapsed. Detection uses two known billing cycles plus seven days without an observed charge. Unknown billing frequency does not lapse automatically. Lapsed is an inference from transaction history, not merchant cancellation evidence.

## Checks

`npm test`: 28 unit tests pass.

`npm run lint` and `npx tsc --noEmit -p .`: pass.

`npm run build`: production build passes on Master.

`node --conditions=react-server scripts/test-cancel-agent.mjs`: real Chromium against an isolated local merchant fixture with in-memory database doubles. Tests password login, saved-session reuse without password submission, incorrect and correct verification codes, approval before cancellation navigation, another approval before the final submission, duplicate requests, other-user denial, proof capture, rejection of ambiguous confirmation, and preservation of a completed result after Stop.

The fixture does not validate PostgreSQL migration application, transaction rollback, production authentication, or any real merchant. Its screenshot is `/tmp/subtracker-fixture-proof.png`; it is not proof of a real subscription cancellation.

## Outstanding acceptance

Deploy the working tree and apply `20261030060000_add_cancel_attempts_and_lapsed`, then verify the live UI and a real merchant through the approval screen. Complete only the explicitly approved cancellation and inspect its saved proof.

The agent retains parked browsers in one Node process for 15 minutes. A restart loses them; multiple application replicas need shared job ownership before scaling. Site-specific CAPTCHA and unsupported flows remain incomplete attempts. Merchant coverage has not been demonstrated beyond the fixture.

Current production uses `Dockerfile` to pull `ghcr.io/mrmoe28/sub-tracker:latest`; redeploying the existing image does not publish this working tree. No repository commit, push, migration, production deployment, or real cancellation was performed during this continuation.
