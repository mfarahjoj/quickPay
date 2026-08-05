# Operator scripts

These run against **production** (`quickpay-485417`) using your own Firebase CLI
login. Treat every one of them as an action taken by you personally: unlike the
admin console, they leave no `admin_audit` entry naming an actor.

That is why none of them can move customer money any more.

| Script | Effect | Moves value? |
|---|---|---|
| `set-admin-claim.js` | Grant, revoke and list admin console roles | No — but it grants the authority that can |
| `audit-privileged-accounts.js` | Report accounts holding a privileged role; `--backfill` files them as pending role requests | No — a request changes nothing until an admin decides |
| `migrate-opening-balances.js` | One-time ledger backfill: posts `opening_balance` entries so the journal explains balances that predate it | No — it records existing balances, it does not create any |
| `generate-icons.js` | Build app icon assets | No |

## Issuing agent float

Use the **float desk** in the admin console. `seed-agent-float.js` was removed
in Admin Console v1 phase G: it credited real value to an agent wallet under
whoever's CLI token happened to be on the laptop, with no second approver, no
audit trail, no receipt for the agent, and it always booked the value to
`float:agents` no matter how the agent had actually paid — so the books could
never be reconciled against a bank or Zaad statement.

The console replaces all of that: request and approval are separate steps, a
second admin is required above the configured threshold, the funding route
decides which asset account is debited, and every step lands in `admin_audit`.

## About `migrate-opening-balances.js`

Kept because it is idempotent, dry-run by default (`--apply` to write), and
cannot create value — entry IDs are deterministic (`opening_{uid}`) and
already-posted entries are skipped, so re-running it is a no-op. It should
already have been run once; there is no reason to run it again.

## Adding a script here

If it would write to `journal_entries`, `ledger_balances` or `wallets`, it
belongs in the admin console as an audited callable instead. See
`ADMIN_CONSOLE_PLAN.md` and the `new-money-flow` skill.
