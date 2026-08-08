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

- [ ] **3. Tighten the `customerTokens` read rule.**
  `firestore.rules` lets *any* authenticated user read *any* token whose status
  is `active`, so the collection can be enumerated for live tokens. Scope reads
  to the owner and the scanning merchant, or move reads behind a callable.
  Check `scanCustomerToken` and the merchant scan screen before changing it.
  *Done when:* a signed-in stranger cannot read someone else's active token and
  the merchant scan flow still works.

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

- [ ] **6. Backup and restore runbook.**
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
  before prod.
