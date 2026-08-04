---
name: new-money-flow
description: Checklist for adding or modifying any backend flow that moves value in Zapp Pay — payments, top-ups, cash-outs, transfers, refunds, payouts, commissions, bonuses, or fee changes. Use BEFORE writing the function, and again as a pre-review checklist after.
---

# New money flow checklist

Every flow that moves value follows the same skeleton. Work through this in order.

## 1. Design the journal entry first (before any code)

- Pick the debit/credit accounts from the chart of accounts in `LEDGER_ARCHITECTURE.md` §3.1 and the per-flow templates in §3.4. Account IDs: `user:{uid}`, `platform:fees`, `platform:promo`, `platform:cashout_hold`, `float:agents`, `float:bank`, `float:zaad`, `float:edahab`, `external:clearing` (see `functions/src/ledger/accounts.ts`).
- Choose the entry `type` (extend the union in `functions/src/ledger/types.ts` if genuinely new).
- Define a **deterministic entryId** = idempotency key, e.g. `p2p_{transactionId}` — same business event must always produce the same ID so retries can never double-post.
- Lines must sum to zero (debits === credits, in cents). If you can't write the entry as zero-sum, the flow design is wrong — money is being created or destroyed.

## 2. Guards (run before posting, inside the callable)

In order:
1. Auth + `enforceAppCheck: true` on the callable (consume the token for high-value operations).
2. PIN verification (`verifyUserPin`) for any user-initiated debit.
3. Role checks — verify the caller's account type server-side; roles are admin-granted, never trusted from client input.
4. KYC per-transaction caps + `enforceVelocity` (`functions/src/utils/velocity.ts`).

## 3. Post through the ledger

- Inside ONE Firestore transaction: reads first (`prepareJournalEntry(tx, input)` does its own reads), then writes (`prepared.write(tx)` exactly once, plus your `transactions` row, notifications doc, etc.).
- **Never mutate `wallets.{uid}.balance` directly** — the projection is updated by the ledger.
- Handle `prepared.alreadyPosted === true` (retry hit): return the existing result, don't write again.
- Overdraft guard is automatic for `user:*` accounts; don't work around it.

## 4. Agent-mediated flows (top-up / cash-out)

- The agent's float debit or credit lives **in the same journal entry** as the customer leg. An agent handing out value must have that value debited from their own wallet atomically — no unbacked creation. (Cash-out is the mirror image: agent receives float.)
- Commission is a separate pair of lines in the same entry: `platform:fees` → `user:{agent}`.

## 5. Rates, fees, display

- Rates come from Firestore `config/rates` with defaults in `functions/src/config/rates.ts`. Never hardcode.
- All amounts integer cents; convert at the edges with `dollarsToCents`/`centsToDollars`.
- Write the user-facing `transactions` row with the **`participants` array** (both sides) and `journalEntryId`.
- Notify via `functions/src/utils/notifications.ts`.

## 6. Firestore plumbing

- New query shapes → composite index in `firestore.indexes.json` (deploy it).
- New collections → rules in `firestore.rules`. Ledger collections are server-only. Client-writable user-doc fields stay restricted to the profile allowlist.

## 7. Tests

- Add Jest coverage in `functions/src/__tests__/`: happy path AND rejection paths (bad auth, insufficient balance, velocity exceeded, replay/idempotency).
- v2 harness style: `wrapped({data, auth})`.
- Run `cd functions && npm test` — all green before review.

## 8. Before deploy

- Does the scheduled `invariantCheck` still hold with the new accounts/entry type? If you added an account kind, confirm it's included in the accounting-equation check.
- Are daily/aggregate limits meant to apply? (Known gap: `getAccountLimits` advertises limits that per-transaction checks don't fully enforce — don't widen that gap.)
- **Do NOT deploy money-path functions to prod without explicit per-target authorization from the user.** Simulate/emulate or deploy to staging first when available.
