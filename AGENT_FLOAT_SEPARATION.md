# Agent float vs shop sales (decision D10)

**Date:** 2026-10-18
**Status:** Approved and built 2026-10-18 on `fix/wallet-phase1`, not deployed.

**Deploying it:** deploy every function together (the ledger itself changed), then straight away open the console's float desk, preview "Separate agent float from wallets", check each agent, and have a super admin apply it. Until an agent is migrated their float account is empty and their cash-ins are refused. On 2026-10-18 prod had one agent (the founder's test agent-merchant), whose journal shows $0 of float; its $100 wallet came from an opening balance, so decide in the preview whether any of it is float.
**Question:** an `agent_merchant` runs a shop *and* does cash-in and cash-out. Today both live in one wallet, `user:{uid}`. Which money is float, which is sales, and may payouts ever draw on float?

---

## 1. What happens today

Everything about an agent-merchant goes through one balance:

| Movement | Ledger today |
|---|---|
| Float bought from Zapp (float desk) | `float:{route}` → **`user:{uid}`** |
| Cash-in given to a customer | **`user:{uid}`** → `user:{customer}` |
| Cash-out taken from a customer | hold → **`user:{uid}`** |
| Agent commission | `platform:fees` → **`user:{uid}`** |
| A customer pays the shop | `user:{customer}` → **`user:{uid}`** |
| Merchant payout | **`user:{uid}`** → settlement hold → `float:{route}` |

What goes wrong because of this:
- **Payouts can take float.** A shop can request a payout of money that was float it was issued to serve customers. Then it can't serve cash-ins, and Zapp has paid out value that was supposed to stay in the agent network (finding F15).
- **Nobody can tell float from takings.** The merchant app shows one number. Ops can't see how much float an agent really holds without tracing the journal by hand.
- **Reconciliation is blurred.** `float:agents` is meant to equal the e-float agents hold against the cash in their drawers. With sales mixed in, that equality can't be checked per agent.
- **Disputes are blurred.** When a cash-out dispute is upheld against an agent, there's no rule for whether it comes out of their float or their earnings.

## 2. What the industry does

The big operators and their regulators all keep an agent's float apart from everything else the agent owns:

- **M-Pesa (Safaricom).** An agent's accounts are listed separately as an *Outlet Float Account*, a *Commissions Account* and a microfinance account ([Safaricom, Float Sasa terms](https://www.safaricom.co.ke/images/Downloads/TERMS-AND-CONDITIONS-FOR-THE-OPENING-AND-USE-OF-THE-FLOAT-SASA-SERVICE.pdf); the same structure in [Safaricom Ethiopia's terms](https://safaricom.et/assets/3eac54d5-7f5a-4f05-a9e9-8c667650ed1d)). Commission is not paid into the float. A shop's own Lipa na M-Pesa till is a separate product again.
- **Float as its own balance.** Practitioners describe an agent as running two balances, physical cash and electronic float. Running out of either stops one kind of transaction, so the two are managed separately ([PaybillKE glossary](https://paybillke.com/glossary/float); [MicroSave](https://www.microsave.net/2015/11/06/the-i-dont-have-enough-float-quandary/)). Rebalancing is a deliberate trip between the till and a bank or super-agent, not something that happens as a side effect of trading ([PaybillKE float guide](https://paybillke.com/guides/mpesa-float-management-for-shops-and-agents-2026)).
- **Regulators require the separation.** The Central Bank of Nigeria requires agents to keep their agency activity apart from their other merchant activity, and to run it through dedicated float accounts ([CBN 2024 circular, via RegAlert](https://regalert.today/document/48ab62a4-a147-485d-a08e-13cefbdac503/text); [CBN agent banking guidelines](https://www.cbn.gov.ng/Out/2013/CCD/GUIDELINES%20FOR%20THE%20REGULATION%20OF%20AGENT%20BANKING%20AND%20AGENT%20BANKING%20RELATIONSHIPS%20IN%20NIGERIA.pdf)).
- **Uganda.** An agent-network application must explain how the institution will manage agent liquidity ([Bank of Uganda, Agent Banking Regulations 2017](https://archive.bou.or.ug/bou/bou-downloads/acts/other_acts_regulations/Agent-Banking-Regulations-2017.pdf)).
- **Seychelles.** E-money rules require the issuer to hold liquid assets at least equal to the outstanding e-float ([Seychelles e-money regulations 2022](https://www.gazette.sc/sites/default/files/2023-01/SI%20128%202022%20-%20National%20Payment%20System%20(Electronic%20Money)%20Regulations,%202022.pdf)).

The Bank of Somaliland's own text isn't online. Whatever licence path Zapp takes, a regulator will expect float to be identifiable per agent and reconcilable.

## 3. Recommendation

**Give every agent a separate float account in the ledger, the way M-Pesa separates the Outlet Float Account from the Commissions Account.**

| Account | What it is | What moves it |
|---|---|---|
| `agent:{uid}` (new) | The agent's **float**: e-value held against cash in the drawer | Float desk issue and withdraw; cash-in given; cash-out received |
| `user:{uid}` (existing) | The agent's own money: **commissions**, and for an agent-merchant, **shop sales** | Commission; customer payments to the shop; payouts; refunds; P2P |

The rules:
1. **Cash-in and cash-out touch only the float account.** An agent with no float can't cash anyone in, however much the shop sold today.
2. **Commission is paid to `user:{uid}`**, never into float. It's earnings, so it can be paid out (like M-Pesa's Commissions Account).
3. **Payouts come only from `user:{uid}`.** Float can never be paid out as takings, which closes F15.
4. **Sales → float is self-service.** "Top up my float from my sales" moves value `user:{uid}` → `agent:{uid}`. It creates nothing, and it's how a busy shop-agent rebalances without visiting ops.
5. **Float → sales is not self-service.** Float leaves only through the ops float desk's withdraw, which is reconciled against the cash or Zaad the agent actually hands over. Otherwise an agent could turn float into a payout by moving it across first.
6. **Upheld disputes** against an agent come from `user:{uid}` (their earnings). The D8 reserve applies there if it's short. Float stays intact, so the agent can keep serving customers while they owe.
7. **Float can't go negative**, the same as a wallet.
8. **Reconciliation:** the sum of all `agent:*` accounts plus agents' cash should equal `float:agents` and the other float routes, now checkable agent by agent in the ledger desk.

What users see:
- **Merchant app (agent or agent-merchant):** two balances, **Float** and **Sales & earnings**, plus a "Move to float" button. Payout screens only offer Sales & earnings. Cash-in screens check Float.
- **Console:** each agent shows their float position, and the float desk issues into it.

## 4. What it takes

| Piece | Work |
|---|---|
| Ledger | New account kind `agent:{uid}`, non-negative, projected like other non-wallet accounts. Included in the invariant check and the activity monitor |
| Agent flows | `agentConfirmTopup`, `manualTopup`, `agentConfirmCashOut` and the float desk post to `agent:{uid}`; commission stays on `user:{uid}` |
| Move to float | One new callable (PIN-gated) and its ledger entry |
| Migration | A one-off, dry-run-first script that works out each agent's current float position from their journal (issued − withdrawn − given in cash-ins + taken in cash-outs) and posts one opening entry moving it from `user:{uid}` to `agent:{uid}`. Ops review the dry run before it's applied |
| Merchant app | Two balances, Move to float, payout and cash-in screens on the right balance |
| Console | Float position per agent, float desk on `agent:{uid}` |
| Tests | Every agent flow, the migration rule, and the invariant |

That's roughly two to three days of focused work, then one deploy and new app builds.

## 5. Decisions inside the recommendation

- **Rule 5:** should an agent ever move float back to sales themselves? This recommends **no** (only through ops), as in the float-account model above.
- **Pure `topup_agent` accounts** (agents without a shop): same split. Their `user:{uid}` holds only commission.
