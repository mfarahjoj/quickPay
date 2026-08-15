# Pre-pilot backlog

Ordered queue for autonomous work. One item per iteration, top unchecked
first. Verified open as of 2026-08-05.

## Rules for whoever (or whatever) works this list

- **Never deploy.** Not functions, rules, indexes or hosting. Everything here
  lands as a commit on a branch; deploying money-path code needs explicit
  per-target authorization from Mahamed.
- **Stop on red.** `cd functions && npm test` and `npm run build` must pass, and
  both apps must `tsc` clean, before an item is ticked. If something fails and
  the fix is not obvious, leave the item unchecked, write what you found under
  it, and stop rather than guessing.
- **Follow `CLAUDE.md`.** Anything touching value also follows the
  `new-money-flow` skill.
- **One item per commit**, message explaining *why*, not just what.
- **Tick the box and commit the tick** as part of the item's commit, so the next
  iteration sees the updated state.
- If an item turns out to be already done or wrong, say so under it and tick it
  with a note. Do not invent work.

---

## Queue

- [x] **0. Node 20 → Node 22 runtime.** *(code done 2026-08-15, deploy pending)*
  Node 20 is decommissioned **2026-10-30**, after which no function deploys at
  all — this gates every other item below it. `engines.node` is now `22` and
  `firebase-functions` is on 7.3.2; build and all 143 tests pass. Applying it
  means redeploying **every** function, including money paths, so it needs
  per-target authorization and is best done as one deliberate pass rather than
  drifting in behind an unrelated change.
  `firebase-admin` is still on 12.7.0 (latest is 14.x) — deliberately left
  alone; a two-major jump on the money path deserves its own change.

- [ ] **1. Ledger reconciliation + alerting.**
  `ledgerInvariantCheck` proves the journal is internally consistent and writes
  `ledger_checkpoints` / `ledger_alerts`, but drift only reaches a log. Add:
  (a) external reconciliation — compare `float:bank` against a recorded
  statement balance and `float:agents` against agent wallet totals, storing the
  result as a checkpoint with an explicit unexplained-difference figure;
  (b) alerting that actually reaches a person on drift or on a missed run.
  Prefer a mechanism that works without new paid infrastructure; document what
  has to be switched on. Surface the result in the admin console's ledger
  banner, which already reads checkpoints.
  *Done when:* a scheduled job records an external-recon result, drift produces
  an alert record plus an ERROR log Cloud Monitoring can page on, and the
  console shows the outcome.

- [ ] **2. `consumeAppCheckToken` on high-value callables.**
  Not used anywhere today. Turn on replay protection for the callables that
  move real value or grant authority: the money paths, the admin float and role
  callables. Check the client SDKs support it before enabling, and note any
  callable deliberately left out.
  *Done when:* consumption is on for high-value callables and the reason for
  each exclusion is written down.
  *2026-08-15:* still open — this is replay protection, which is separate from
  plain enforcement. Enforcement itself was extended that day to
  `generateQRCode`, `generateMerchantSticker`, `scanCustomerToken` and
  `createPaymentRequest`, which had none; every money-path callable now at
  least enforces.

- [x] **3. Tighten the `customerTokens` read rule.** *(code done 2026-08-15, deploy pending)*
  Scoped to the owner: `allow read: if isAuthenticated() && isOwner(resource.data.customerId)`.
  The `status == 'active'` clause was satisfiable by a *query*, not just a
  document get, so any signed-in user could list every live token and harvest
  the `customerId` behind each. Nothing broke by removing it — neither app
  reads `customerTokens` from the client at all (verified: the only client
  collection reads are `fcmTokens`, `merchantProfiles`, `notifications`,
  `paymentRequests`, `users`, `wallets`); the whole flow goes through
  `generateCustomerToken` / `scanCustomerToken` / `createPaymentRequest` on the
  Admin SDK. Rules compile clean; **not yet deployed**.

- [ ] **4. Refund happy-path test.**
  `refundPayment` has no test covering a successful refund — only rejection
  paths exist elsewhere. Cover the reversal amounts (merchant net, platform
  fee, customer gross), the `refundedAt` idempotency guard, and that a second
  refund attempt fails.
  *Done when:* the happy path and the double-refund guard are both asserted.

- [ ] **5. Card-funded balance holds.**
  Stripe top-up → instant wallet → agent cash-out is a clean card-fraud pipe
  with no chargeback defense. Add a delayed-availability window for
  card-funded value and cash-out rules that respect it. Needs a design decision
  on window length — propose one with reasoning rather than picking silently.
  *Done when:* card-funded value cannot be cashed out immediately, and the
  customer is told why in all three locales.

- [ ] **6. Callable error-rate alerting.**
  Added 2026-08-15 after `generateQRCode` was found failing on *100% of calls*
  in prod — `ENCRYPTION_KEY` was never set on the project, so merchant receive
  was down, not degraded. Nothing surfaced it; it was found only because a
  human tried the feature by hand. Item 1 covers ledger drift, which is a
  different signal: this is "a callable is throwing on every invocation."
  Cheap version: a log-based metric on `severity=ERROR` per function with an
  alert policy on sustained non-zero error rate for the money-path callables.
  Also worth auditing for the same class of bug — config read at runtime with
  no deploy-time check that it exists.
  *Done when:* a callable failing every call raises an alert that reaches a
  person without anyone having to try the feature.

- [ ] **7. Backup and restore runbook.**
  Firestore PITR and scheduled exports are not configured, and there is no
  written restore procedure. Write the runbook and whatever scripted pieces are
  possible from the repo; flag clearly which steps need console access.
  *Done when:* `docs` (or root) holds a runbook someone could follow under
  pressure, and any automatable part is committed.

---

## Not for a loop — these need Mahamed

Listed so nothing tries to fake progress on them:

- **Deploy the admin console** (Firebase Web app, App Check key, Hosting site,
  admin claim) — see `admin/README.md`. Everything built since 2026-08-04 is
  unverified against real data until this happens.
- **Migration run:** `scripts/audit-privileged-accounts.js --backfill`, then
  review each existing agent in the console.
- **Banking and licensing:** safeguarding account, FCA/EMI partner, Bank of
  Somaliland. Longest lead time of anything here and entirely non-code.
- **Zaad / eDahab API access.** `functions/src/integrations/` are sandbox stubs
  that fake success; there are no real rails until Telesom/Dahabshiil grant
  access.
- **Android build.** Somaliland is Android-dominant; iOS-first serves the
  diaspora sender, not the Hargeisa receiver.
- **Staging Firebase project.** Money-path changes currently have nowhere to run
  before prod. *Promoted 2026-08-15:* the `ENCRYPTION_KEY` outage is exactly the
  class this catches — a config value present nowhere, invisible until a real
  user hits the feature. It sat broken in prod undetected.

- **Test build 8 of the merchant app.** Uploaded 2026-08-15 with the reworked
  receive screen (live confirmation, counter code, hardening). The UI shipped
  without anyone driving it — the simulator session was signed out and signing
  in needs a phone number and OTP. Worth walking amount → QR → pay → paid state
  and checking the gross/fee/net split before pilot merchants see it.
