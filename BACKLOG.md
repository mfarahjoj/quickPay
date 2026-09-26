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

- [x] **0. Node 20 → Node 22 runtime.** *(deployed 2026-08-15 — all 65 functions on nodejs22)*
  Node 20 is decommissioned **2026-10-30**, after which no function deploys at
  all — this gates every other item below it. `engines.node` is now `22` and
  `firebase-functions` is on 7.3.2; build and all 143 tests pass. Applying it
  means redeploying **every** function, including money paths, so it needs
  per-target authorization and is best done as one deliberate pass rather than
  drifting in behind an unrelated change.
  `firebase-admin` is still on 12.7.0 (latest is 14.x) — deliberately left
  alone; a two-major jump on the money path deserves its own change.
  Deployed 2026-08-15: all 65 functions redeployed on `nodejs22`, no failures,
  and both CLI warnings (runtime deprecation, outdated firebase-functions)
  are gone.

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

- [x] **3. Tighten the `customerTokens` read rule.** *(deployed 2026-08-15)*
  Scoped to the owner: `allow read: if isAuthenticated() && isOwner(resource.data.customerId)`.
  The `status == 'active'` clause was satisfiable by a *query*, not just a
  document get, so any signed-in user could list every live token and harvest
  the `customerId` behind each. Nothing broke by removing it — neither app
  reads `customerTokens` from the client at all (verified: the only client
  collection reads are `fcmTokens`, `merchantProfiles`, `notifications`,
  `paymentRequests`, `users`, `wallets`); the whole flow goes through
  `generateCustomerToken` / `scanCustomerToken` / `createPaymentRequest` on the
  Admin SDK.

- [ ] **3b. Audit every sandbox stub that gates value.** *(guard shipped, audit open)*
  Found 2026-08-15 while sweeping `process.env` before the Node 22 redeploy.
  `stripeWebhook` is a public unauthenticated endpoint that credits a wallet
  against `float:bank`, and `verifyWebhook` returns the request body *without
  checking any signature* when `STRIPE_SANDBOX` is on — which it is by default
  whenever the env var is unset, i.e. in prod. Combined with `createWebTopup`
  (also public, CORS-only, returns a `clientSecret` the paymentIntentId is
  derivable from), an unauthenticated caller could create a pending top-up up
  to $5,000 and then confirm it themselves. Unbacked value, money rule 3.
  Guard added: `stripeWebhook` now returns 503 unless Stripe is genuinely
  configured, with a test pinning it.
  *Still open:* the same question for `zaad.service` and `edahab.service` —
  both fake success and both sit behind `*_SANDBOX ?? "true"`. Check every
  path where a stub's return value leads to a journal entry.
  *Done when:* no sandbox stub can cause a credit, and each is covered by a
  test that fails if the guard is removed.
  *2026-09-18, found during the two-week GTM readiness review:* the audit this
  item asked for turned up two more paths, both of which were live in prod and
  reachable from the customer app's top-up and remittance screens:
  `topupFromMobileMoney` (no App Check; Zaad/eDahab stub "success" →
  `float:{provider}` debit, user credit) and `completeRemittance` (no App
  Check; takes `paymentIntentId` from the client and never matches it against
  the remittance's stored intent or amount, while the Stripe stub answers
  "succeeded" for any id). `cashOutToMobileMoney` is the mirror: real wallet
  debit, no payout. All four were **deleted from prod** on Mahamed's explicit
  authorization and their exports removed from `index.ts` so a full redeploy
  cannot resurrect them; `mobileMoneyWebhook` stays, since it rejects anything
  unsigned. Not yet done: checking prod `journal_entries` for existing
  `mmtopup_` / `remit_` ids (needs console access), and the guard-plus-test
  this item actually asks for.

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

- [ ] **8. Localise the merchant app's remaining server errors.**
  Added 2026-09-26. The agent confirm, payout and payroll screens now map
  failures through `pinActionErrorKey` in `merchant-app/src/utils/errors.ts`,
  (and, since 2026-09-26, charge), but manual top-up (`TopupCustomerScreen`),
  refund (`TransactionDetailScreen`), scan (`ScanCustomerScreen`) and login/OTP
  still show `e.message` first — English server text, including "Invalid agent PIN" and
  "Invalid PIN" on the two PIN-gated ones.
  *Done when:* none of those screens can show a raw server message, and a wrong
  PIN on top-up or refund goes back to the keypad instead of failing the flow.

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

- **Test merchant build 10 and customer build 58.** Uploaded 2026-09-26 (after
  9 and 57 the same day), with every backend change they need deployed first:
  payouts, agent PIN, retry-safe `payMerchant`, and the charge safety work
  (90-second window, `cancelPaymentRequest`, one charge per scan). Both apps
  were only booted on a simulator to the signed-out welcome screen; nothing
  behind sign-in has been driven, since that needs a phone number and OTP.
  Worth walking, on two devices:
  charge — scan a customer and let it run out (Expired at 90s); charge again
  and Cancel (the customer's approve screen should flip to "Request
  cancelled"); charge and back out mid-wait (should ask "Cancel this
  charge?"); charge and approve;
  merchant — Get paid (request → the admin payout desk → "Sent" with the
  reference), confirm top-up and cash-out with a wrong PIN first (back to the
  keypad with the code kept), a two-person payroll, the counter-code feed, the
  receive flow, and back/swipe on every screen;
  customer — sign out and log back in with the PIN (needs the grant below),
  and a sticker payment.
  Merchant build 8 can no longer confirm agent top-ups or cash-outs (the
  backend requires the PIN it never sends), and merchant 9 keeps spinning
  when a charge expires, since only build 10 counts down.
- **Let the functions mint sign-in tokens.** `loginWithPin` (trusted-device PIN
  login, first shipped in customer build 57) calls `createCustomToken`, which
  signs through IAM as `76440907220-compute@developer.gserviceaccount.com`. That
  account only has `roles/editor`, which does not include
  `iam.serviceAccounts.signBlob` (checked 2026-09-26), so every PIN login fails
  after the PIN is accepted and the customer has to fall back to an SMS code.
  Fix: Cloud Console → IAM & Admin → Service Accounts → that account →
  Principals with access → Grant access → the same account as principal, role
  *Service Account Token Creator*. The IAM Credentials API is already enabled.
