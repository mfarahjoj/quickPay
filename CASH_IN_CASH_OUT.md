# Cash-in and cash-out at agents

How cash becomes Zapp balance and back again, what the ledger records at each step,
and what each guard is there to stop. Written 2026-10-03 after a test cash-out took
money from the wallet with no visible record and no way back.

The model is the one Zaad, M-Pesa, bKash, Alipay and Paytm agents use:
**the agent's own e-money float is the other side of every cash movement.** A cash-in
moves value from the agent's float to the customer. A cash-out moves value from the
customer to the agent's float. No path creates value; the platform only pays
commission out of `platform:fees`.

Only `topup_agent` and `agent_merchant` accounts can confirm either flow. Plain
`merchant` accounts were removed from top-up on 2026-10-03: an agent's float is
admin-issued and reconciled, but a shop's balance is just its sales.

---

## Cash-in (top-up)

1. **Customer** asks for a top-up in the app (`customerRequestAgentTopup`).
   - Guards: App Check, active account, KYC per-transaction cap, $1–$1,000,
     5 requests an hour and 15 a day.
   - Writes `agentTopupRequests/{id}` with status `pending`, a 6-digit code and a
     30-minute expiry. **No money moves.**
   - The app shows a QR `{type:'zapp_topup', code}` and the digits.
2. **Customer** hands the agent cash.
3. **Agent** scans the QR or types the code, then enters their PIN (`agentConfirmTopup`).
   - Guards: App Check, agent PIN, agent role and active status, request pending and
     not expired, agent ≠ customer, agent float ≥ amount.
   - One Firestore transaction posts `agenttopup_{id}`, marks the request completed and
     writes the `transactions` row with both participants.
4. **Expiry:** `expireAgentRequests` (every 5 minutes) marks stale requests `expired`
   so an old code can't be confirmed later. No money to return.

| Entry `agenttopup_{id}` | Debit | Credit |
|---|---|---|
| Float to customer | `user:{agent}` amount | `user:{customer}` amount |
| Commission (rate from `config/rates`) | `platform:fees` | `user:{agent}` |

The agent handles the cash first and confirms second, so the agent carries the risk of
handing value over before the confirm succeeds. That is the industry norm: the agent
holds the cash until the app says done.

---

## Cash-out (withdrawal)

The customer authorises the debit with their PIN up front. The money moves into escrow
at that moment, which is why the wallet balance drops before any agent is involved.
Every outcome is recorded; held money always ends in exactly one place.

```
        customerCashOut                    agentConfirmCashOut
user:{customer} ──hold──▶ platform:cashout_hold ──settle──▶ user:{agent}
        ▲                        │
        └────────release─────────┘  cancelCashOut · expireAgentRequests · 5 wrong codes · replaced
```

### 1. Request (`customerCashOut`)
- Guards: App Check, customer PIN, PIN-reset cooldown, KYC per-transaction and
  aggregate limits, `enforceVelocity`, active account, balance.
- Code: `crypto.randomInt` (it was `Math.random`). Expiry is 30 minutes.
- Any older pending cash-out from the same customer is released first, with reason
  `replaced`. A customer has one live cash-out at a time.
- One transaction posts the hold, writes `cashOutRequests/{id}` with `failedAttempts: 0`
  and the `transactionId`, and writes a **pending `withdrawal` row** to `transactions`
  (participants `[customer]`, `journalEntryId` = the hold entry). The customer sees the
  pending withdrawal in their history straight away.
- The app shows a QR `{type:'zapp_cashout', id, code}`, the digits, a countdown, a note
  that the money is held rather than spent, and **Cancel cash-out**.

### 2. Settle (`agentConfirmCashOut`)
Order of checks. Cheap checks and the PIN come before any code is compared, so a wrong
PIN costs no code guess:
1. 6-digit code is present.
2. Agent PIN is present.
3. **The call names one request**: the `cashOutId` from the QR, or the customer's phone
   number typed with the code. A bare code is refused.
4. Agent role is `topup_agent` or `agent_merchant`, and the agent is active.
5. `verifyUserPin`, then the agent's OTP lockout (`assertNotOtpLocked`).
6. Resolve the request: by id, or phone → user → their pending request.
7. Constant-time code comparison. A wrong code records an OTP failure against the agent
   and increments `failedAttempts` on the request. **At 5 the request is released**,
   reason `too_many_attempts`.
8. The request is pending and not expired (an expired one is released on the spot),
   agent ≠ customer, and the customer is still active.
9. One transaction posts the settle entry, marks the request `completed` and updates the
   pending row to `completed`, adding the agent as participant. Requests made before
   this change have no row, so one is created.
10. The customer gets a `cashout_completed` notification. The agent hands over the cash
    after the success screen.

### 3. Release (`releaseCashOutHold` in `topup/cashOutHold.ts`)
One idempotent path used by every way a cash-out can end without payment:

| Reason | Trigger | Request status | Customer notified |
|---|---|---|---|
| `cancelled` | Customer taps Cancel (`cancelCashOut`, owner only, no PIN since money only returns to its owner) | `cancelled` | yes |
| `expired` | `expireAgentRequests` sweep, or an agent trying an expired code | `expired` | yes |
| `too_many_attempts` | 5th wrong code on this request | `cancelled` | yes |
| `replaced` | Customer starts a new cash-out | `cancelled` | no (they're looking at the new one) |

It does nothing unless the request is still `pending`, so a release racing a settle
ends in exactly one of them. The `transactions` row moves to `cancelled` with
`releaseEntryId`. History shows the amount struck through and labelled.

### Ledger entries

| Entry | Type | Debit | Credit |
|---|---|---|---|
| `cashouthold_{id}` | hold | `user:{customer}` | `platform:cashout_hold` |
| `cashout_{id}` | settle | `platform:cashout_hold` | `user:{agent}` |
| ″ commission | | `platform:fees` | `user:{agent}` |
| `cashoutrelease_{id}` | adjustment | `platform:cashout_hold` | `user:{customer}` |

Settle and release are mutually exclusive and keyed by request id, so each runs at most
once. `platform:cashout_hold` should equal the sum of pending cash-outs; the invariant
check catches drift.

---

## Threat model

| Threat | Before | Now |
|---|---|---|
| Brute-forcing codes | A code alone matched any pending request, so agents could pool guesses across every customer (1 in 10⁶ per guess per request) | Every attempt targets one request; 5 wrong codes return the money and kill the code; agent lockout still applies |
| Predictable codes | `Math.random` | `crypto.randomInt` |
| Shoulder-surfed code used elsewhere | Code was enough | Also needs the QR's request id or the customer's phone |
| Money stuck in escrow | Unclaimed holds stayed in `cashout_hold` indefinitely | Customer cancel, 5-minute expiry sweep, release on replace |
| "My money vanished" | No history row until an agent confirmed | Pending row at request, cancelled or completed at the end, plus push notifications |
| Self-dealing | Agent could cash out their own request | `agentId === customerId` refused |
| Non-agents moving cash | Plain merchants could confirm top-ups | Agents only, both flows |
| Unbacked value | — | Float debit and customer credit in one entry; overdraft guard on `user:*` |
| Stolen phone, wrong PIN | — | PIN on every debit; PIN-reset cooldown blocks cash-out after a reset |
| Forged client | — | App Check enforced on every callable |

### Known gaps (not fixed here)
- **Daily cash-out velocity per agent.** Agent caps rely on float size and admin review.
- **Agent sees the amount only after confirming.** M-Pesa shows the agent the amount and
  name before the PIN. A preview call would cost a lookup but help agents catch mistakes.
- **Customer-side approval.** bKash and Alipay push "Agent X is paying you $15, approve?"
  to the customer. The QR plus cancel covers most of this risk. Worth revisiting if
  disputes appear.
- **Real rails.** Zaad/eDahab integrations are still sandbox stubs, so agent float is
  issued manually through the admin Float desk.

---

## Rollout notes

Order matters, because old merchant builds send a bare code and are now refused with a
message telling the agent to update:
1. Deploy indexes `cashOutRequests(status, expiresAt)` and
   `agentTopupRequests(status, expiresAt)`. Answer **N** to any prompt to delete
   indexes.
2. Deploy functions `customerCashOut`, `agentConfirmCashOut`, `cancelCashOut`,
   `expireAgentRequests` and `agentConfirmTopup`.
3. Ship both apps. The customer app shows the QR; the merchant app scans it or takes
   phone + code. Both carry the App Check `AppDelegate` fix, so release builds need a
   real-device check.

Code: `functions/src/topup/` · Tests: `functions/src/__tests__/cashOutFlow.test.ts`,
`agentConfirmPin.test.ts`.
