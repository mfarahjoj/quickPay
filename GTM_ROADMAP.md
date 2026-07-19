# Zapp Pay — Go-to-Market Roadmap: Hargeisa

*Drafted 2026-07-08. Working doc — revisit monthly.*

---

## 1. Thesis

Hargeisa already lives on mobile money. Zaad (Telesom) and eDahab (Somtel) own P2P and everyday payments, run on USSD, and are effectively free to consumers. **Zapp Pay does not win by being "another wallet" — it wins by being the neutral, smartphone-native layer the incumbents can't be:**

1. **Diaspora money in one tap.** Family in London/Minneapolis/Dubai tops up a Hargeisa wallet instantly with a Visa/Mastercard (Stripe rail — already built). No remittance counter, no agent queue on the sending side.
2. **One QR for every merchant.** Merchants today juggle a Zaad number *and* an eDahab number taped to the till. Zapp gives them one QR, digital receipts, refunds, payroll, and real analytics (the merchant app is genuinely ahead of anything Zaad/eDahab offer merchants).
3. **A Zaad-style agent float network** for cash-in/cash-out, so the model is instantly familiar — no user education needed on how money enters and leaves.

Positioning line: **"Lacagta reerka iyo ganacsigaba — hal app."** (Family money and business money — one app.) English: *"The modern way to get paid in Hargeisa."*

---

## 2. Market snapshot (what we're walking into)

| Factor | Reality | Implication for Zapp |
|---|---|---|
| Incumbents | Zaad ~dominant, eDahab strong #2; both telco-owned, USSD-first, entrenched agent networks | Don't fight P2P head-on. Wedge = diaspora inflows + merchant experience + neutrality |
| Currency | Heavily dollarized; USD is the mobile-money currency, SLSH for small cash | Zapp is USD-native already — matches behavior |
| Devices | Android dominates by a wide margin; iPhones are a small urban minority | **Android app is launch-gating.** iOS TestFlight alone cannot carry a pilot |
| Connectivity | Decent 4G in Hargeisa (Telesom/Somtel), intermittent at edges | Offline-tolerant UX matters; QR works without the payer having data if flows are designed for it |
| Remittances | Lifeline-scale inflows from UK, US, Scandinavia, Gulf; WorldRemit/Taaj/Dahabshiil already terminate into Zaad | Our diaspora edge must be *instant, in-app, card-funded, send-to-anyone* — not just "cheaper" |
| Trust | Money = trust; new wallets are guilty until proven liquid | Visible cash-out guarantee, physical presence, respected launch merchants |
| Regulation | Central Bank of Somaliland licenses mobile money / e-money issuers (Zaad and eDahab are licensed) | Engage CBS **now** with local counsel — this is the longest-lead item and it gates everything |

---

## 3. Beachhead segments (in order)

1. **Diaspora-connected households** — receiver in Hargeisa, sender abroad. The sender downloads Zapp too (or uses a web top-up page) and funds with a card. This is the acquisition engine: every receiver recruits their own sender.
2. **Cafés, restaurants, fast food, supermarkets in central Hargeisa** — high daily transaction counts, young clientele, owners frustrated by dual-wallet reconciliation. Target the corridor: Independence Ave / downtown / Jigjiga Yar / around the universities.
3. **University students & young professionals** (University of Hargeisa, Gollis, Admas, etc.) — smartphone-native, price-insensitive to novelty, natural ambassadors, dense social graphs.
4. **Small employers** (10–50 staff) — the merchant app's payroll feature is a genuine differentiator: pay all staff wallets in one batch, free or near-free.

Explicitly **not** targets at launch: rural users, feature-phone users (no USSD yet), government/large-enterprise, cross-border B2B.

---

## 4. Phased roadmap

### Phase 0 — Launch readiness (July – August 2026)

**Goal:** legally allowed to operate, both apps in stores, money-safety gaps closed, pilot cohort recruited.

**Regulatory & corporate (start week 1 — longest lead):**
- [ ] Retain Hargeisa counsel; map CBS licensing path (e-money issuer / PSP / partnership with a licensed institution as interim). Get a written opinion on what a closed pilot may do before full license.
- [ ] Decide corporate structure for Stripe: **Stripe does not support Somaliland entities** — you need a UK/US entity (e.g., UK Ltd) to hold the Stripe account, plus a documented flow-of-funds between that entity and local float. This is both a legal and an accounting workstream.
- [ ] Define KYC tiers with counsel (e.g., Tier 1: phone + name, low caps; Tier 2: ID photo, higher caps) and align app caps to them.
- [ ] Draft AML/CTF policy + sanctions screening approach (required for the Stripe entity anyway).

**Product gates (from the security review — must close before real money):**
- [ ] **Admin approval gate for agent/merchant roles** — currently anyone can self-select `agent_merchant`. Blocking.
- [ ] **Enforce daily aggregate limits** — `getAccountLimits` advertises them; nothing enforces them. Blocking.
- [ ] Stripe: sandbox → live keys, webhooks, chargeback/dispute handling policy (card top-ups will attract fraud — start with low per-card caps, 3DS required).
- [ ] Android app productionized: signed release build, Play Store listing, push notifications, App Check for Android.
- [ ] Finish so/ar translations (Somali is the launch language — English-only strings are a credibility problem).
- [ ] Agent reconciliation report (daily float vs. ledger) — you cannot run agents without this.
- [ ] Staging environment reachable + test phone numbers, so releases can be verified without touching prod money.

**Field prep:**
- [ ] Rent/brand a small ground-floor office or kiosk in central Hargeisa — the "Zapp House." It is a trust signal as much as an office: cash-out is *always* possible here.
- [ ] Recruit 2 field BD reps + 1 support lead (Somali-speaking, on WhatsApp/phone).
- [ ] Sign 10 anchor merchants (LOIs) and 5 founding agents; seed agent float ($500–$2,000 each, tracked with the reconciliation report).
- [ ] Optional awareness moment: a small presence at the **Hargeisa International Book Fair** (usually late July/August) — teaser only, collect pilot signups, don't launch there.

**Exit criteria:** CBS path agreed in writing • both apps installable by a normal user • both blocking security items closed • 10 merchants + 5 agents signed • support line live.

---

### Phase 1 — Closed pilot (September – October 2026)

**Goal:** prove the loop *top-up → pay merchant → merchant cash-out/agent float turnover* with real money, small blast radius.

- **Scope:** one district (downtown/Jigjiga Yar corridor). Invite-only via referral codes (invite screen already built). Targets: **500–1,000 customers, 30–50 merchants, 8–10 agents.**
- **Seeding tactics:**
  - Every new user gets a small credit (e.g., $1–2) usable only at pilot merchants — drives first payment, funds the merchant side of the flywheel.
  - Campus ambassadors (10 students, paid $50–100/mo + bonuses per activated user) at two universities.
  - Diaspora beta: 50 sender-side testers recruited through founders' networks in UK/US — measure card top-up conversion and cost end-to-end.
- **Cadence:** weekly metrics review; fortnightly merchant visits; fix-list triaged weekly. Support response < 1 hour during business hours.
- **What we're testing (kill/scale questions):**
  1. Do customers make a **second** payment within 14 days? (habit signal)
  2. Does the diaspora top-up actually convert, and what does it cost per $ delivered (Stripe fees + FX + fraud losses)?
  3. Does agent float turn over ≥ 2×/week? (agent economics viability)
  4. Merchant complaint rate on the 1% fee — absorbed quietly, or price-passed/resisted?

**Exit criteria:** ≥ 60% of pilot users transact ≥ 2×; ≥ 70% of merchants active weekly; zero unreconciled ledger discrepancies; fraud/chargeback < 0.5% of top-up volume; support ticket rate falling week-over-week.

---

### Phase 2 — Public Hargeisa launch (November 2026 – January 2027)

**Goal:** open registration city-wide; make Zapp visible everywhere in central Hargeisa.

- **Targets:** 10,000 registered / **3,000 weekly active payers**, 300 merchants, 30 agents by end of January.
- **Launch playbook:**
  - **Merchant blitz:** 2 BD reps sign 8–10 merchants/week each. Kit = QR stand, window sticker ("Zapp Aqbalaa" / We accept Zapp), 30-second onboarding on the merchant app. First 90 days fee-free, then the 1% kicks in (grandfather anchor merchants at a discount).
  - **Referral engine:** both-sides reward ($0.50–$1 each) on first payment, capped; the referral screen exists — wire the incentive.
  - **Channels (in order of $/impact for Hargeisa):** TikTok + Facebook (Somali-language creative, local creators), campus activations, FM radio spots, billboards on Independence Ave & airport road, WhatsApp merchant/community groups, Friday-market activations.
  - **Diaspora campaign:** targeted FB/IG/TikTok ads at Somali communities in London, Birmingham, Minneapolis, Columbus, Stockholm, Dubai — "Top up your family's Zapp in 10 seconds." Landing page + web top-up (no app install needed on the sender side if you ship a simple Stripe checkout page — recommended Phase 2 build).
  - **Trust campaign:** publish the cash-out promise; film real agents/merchants; founder does local podcast/TV interviews.
- **Product in this phase:** web sender top-up page; merchant settlement/cash-out polish; partial refunds; in-app Somali support chat; (stretch) bill-pay pilot with one school or utility.

**Exit criteria:** 3,000 WAP with ≥ 35% D30 retention; ≥ 200 merchants transacting weekly; agent network self-sustaining on commissions in ≥ 5 neighborhoods; CAC < $2 blended.

---

### Phase 3 — Densify & monetize (February – June 2027)

**Goal:** make Zapp the default at point-of-sale in central Hargeisa and the default diaspora top-up rail; get unit economics to breakeven trajectory.

- **Ramadan/Eid campaign (≈ Feb 17 – Mar 20, 2027):** the single biggest remittance/gifting window of the year. Diaspora push ("send Eid money home on Zapp"), zakat/gift framing, merchant vouchers. Plan creative and float liquidity for a 2–3× volume spike — this is the moment the diaspora wedge either compounds or doesn't.
- **Payroll GTM:** sell the payroll feature to 20–30 SMEs (hotels, restaurants, schools, NGOs' local staff). Payroll is a Trojan horse: every payroll run creates funded consumer wallets with zero CAC.
- **Billers:** 2–3 recurring billers (school fees, water, internet) — recurring transactions anchor retention.
- **Agent expansion:** 60–100 agents; introduce float credit lines for top agents; weekly reconciliation automated.
- **Evaluate then:** eDahab/Zaad settlement interop (README lists the APIs; treat as partnership negotiations, not code), Berbera/Burco expansion, USSD companion for feature phones.

**Exit criteria:** 10,000+ WAP; take-rate revenue covering variable costs (Stripe fees, agent commissions, support); a written decision on city #2 vs. deepen Hargeisa.

---

## 5. Pricing & unit economics (current model, stress-tested)

Current configured model (`config/rates`): **1% payment fee, merchant absorbs · 2% agent top-up commission, platform pays.**

- **Customer:** free to register, free P2P, free to pay merchants, free agent top-up. Keep it free — Zaad trained the market on free.
- **Merchant: 1%** — sellable *if* bundled as "receipts + refunds + analytics + payroll for 1%," not "a fee Zaad doesn't charge." First 90 days free. Watch pilot resistance closely; a 0.5% tier for high-volume anchors is acceptable.
- **Agent commission: 2% platform-funded** — this is CAC, not a margin line. At pilot scale it's cheap user acquisition; cap exposure with per-agent daily volume limits until reconciliation is automated.
- **Diaspora card top-up:** Stripe costs ~2.9% + $0.30 (+ FX). Recommended: charge the **sender** a transparent flat fee (e.g., 3% or $2.99 flat under $100) — senders benchmark against WorldRemit/Dahabshiil fees, not against free. Receiver always gets the full amount. Never make the receiver pay.
- **Unit math to track weekly:** revenue per active user vs. (2% commission on their agent top-ups + support cost + incentive spend). The model turns profitable when diaspora top-ups (sender-paid margin) and merchant fees outgrow agent-commission CAC — that mix shift *is* the business model, watch it as a first-class KPI.

---

## 6. KPI dashboard (define once, in Firestore/BigQuery, before pilot)

| KPI | Pilot target | Public-launch target |
|---|---|---|
| Weekly active payers (WAP) | 300 | 3,000 |
| Payments per active user / week | ≥ 1.5 | ≥ 2.5 |
| D30 retention (payers) | ≥ 40% | ≥ 35% |
| Merchants transacting weekly | ≥ 70% of signed | ≥ 65% of signed |
| Agent float turnover | ≥ 2×/week | ≥ 3×/week |
| Top-up mix (diaspora card %) | measure | ≥ 25% of value |
| Fraud + chargebacks | < 0.5% of top-up value | < 0.3% |
| Blended CAC | < $3 | < $2 |
| Support tickets / 100 WAP / week | < 10 | < 5 |

---

## 7. Top risks & mitigations

1. **Regulatory stall (highest).** CBS licensing is opaque and slow. → Start now, local counsel, consider operating under/with a licensed partner for the pilot; keep pilot volumes small and documented.
2. **Incumbent retaliation.** Telesom/Somtel can cut promo prices, lean on merchants, or throttle goodwill. → Stay neutral-rail (we *complement* both), avoid public "Zaad killer" framing, build the diaspora rail they structurally can't match quickly.
3. **Float liquidity crunch.** A demand spike (Ramadan) with under-floated agents breaks the cash-out promise once — and trust twice. → Float dashboards, agent credit lines, Zapp House as liquidity backstop.
4. **Card fraud through Stripe.** New corridors attract carders. → 3DS mandatory, low initial per-card/per-receiver caps, velocity rules, manual review queue over $200, grow caps with history.
5. **Trust deficit.** One viral "Zapp ate my money" story is existential. → Sub-hour support, generous no-quibble reversals in the pilot, publish the cash-out guarantee, physical office.
6. **Two-sided cold start.** Merchants without payers churn; payers without merchants churn. → Corridor density strategy (own 3 streets before 30), spend-only signup credits route users to merchants.

---

## 8. Next 30 days (July 8 – August 8)

1. Retain counsel; first CBS meeting booked. *(Owner: founder)*
2. Incorporate/confirm the foreign entity for Stripe live mode. *(founder)*
3. Close the two blocking product gates: agent-role admin approval + enforced daily limits. *(eng)*
4. Android release build in closed testing on Play. *(eng)*
5. Finish so/ar translations. *(eng)*
6. Agent daily reconciliation report. *(eng)*
7. Sign 10 anchor merchants + 5 founding agents (LOIs, kits ordered). *(BD)*
8. Zapp House location shortlisted; support WhatsApp line live. *(ops)*
9. KPI dashboard live on pilot metrics. *(eng)*
10. Pilot invite list of 500 built (ambassadors + diaspora beta senders). *(marketing)*

---

*Assumptions to validate with local counsel/partners: CBS licensing route and timeline; Stripe entity structure; card-scheme rules for funding third-country wallets. Nothing in this doc is legal advice.*
