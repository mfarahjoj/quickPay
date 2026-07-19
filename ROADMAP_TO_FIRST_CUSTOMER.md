# Zapp Pay — Roadmap to Market & First Customer

*Drafted 2026-07-18. This is the execution plan. Strategy parent: [GTM_ROADMAP.md](GTM_ROADMAP.md) (its wallet-era phases activate at Phase 4 below). Update the checkboxes here at the start of every Zapp work session.*

---

## Locked decisions (2026-07-18)

| Decision | Choice |
|---|---|
| Launch shape | **Both apps launch — in no-custody mode.** Zapp Pay Merchant = QR + sales ledger. Zapp Pay (customer) = scan-and-pay companion. All money moves Zaad→Zaad via USSD; Zapp holds nothing, so no CBS license is required for launch. Wallet/top-up/diaspora features stay built but dormant behind a config flag. |
| Budget (next 90 days) | $1k–5k. Plan below spends ≈ $1.5k; the rest is reserve. |
| Founder bandwidth | ~10–15 h/week, solo. Ridy stays primary. Timeline is calibrated to this — resist scope creep. |
| Regulatory | Deferred until traction (see Phase 4 trigger). One cheap legal sanity check happens anyway in Phase 0. |
| Rails | **Zaad-only at launch** (`*880*` USD, Telesom-verified via Ridy work). eDahab switches on via remote config the day its merchant USSD syntax is confirmed. |

**Definition — "first customer boarded" (the goal of this document):**
A real Hargeisa merchant who, after onboarding, processes **≥ 20 Zapp-QR customer payments across 5 consecutive trading days with no founder present**, and says they'd keep using it. Secondary marker: ≥ 25 Zapp Pay payer installs, ≥ 40% of them having made at least one payment.

---

## 1. What we have (verified on disk, 2026-07-18)

| Asset | State | Role in V1 launch |
|---|---|---|
| Backend (`functions/`, ~40 TS functions) | Built: auth/PIN/KYC/limits, QR gen·validate·pay·refund, agent top-ups, cash-out, Stripe remittance + webhooks, referrals, rates config | V1 uses auth, merchant profiles, QR generate/validate, referrals. Wallet, top-up, remittance functions stay **dormant** (do not delete — they're the Phase 4 product) |
| Zapp Pay Merchant (`merchant-app/`, 72 TS/TSX files) | Full RN structure: screens, navigation, services, i18n | **Core of V1** — needs QR pivot + confirm UX + ledger polish |
| Zapp Pay customer (`mobile/`, 104 TS/TSX files) | Full RN structure incl. wallet screens | Launches as **payer companion**: scan → amount → USSD dial, history, receipts. Wallet screens hidden behind `custody_enabled=false` |
| Firebase | Prod `quickpay-485417` + `quickpay-staging`; Firestore rules with role separation | Use staging for all real-money testing first |
| Brand | "Zapp Pay", Coral Bolt lockup, onboarding designs (`~/Downloads/Zapp Pay *.html`) | Merchant kit + store listings |
| Strategy | GTM_ROADMAP.md (2026-07-08): thesis, corridor, pricing, KPIs | Beachhead corridor + KPI definitions reused as-is |
| From Ridy | USSD compose pattern (iOS `#` limitation + copy-sheet solved), remote-config USSD templates, deep-link infra, TestFlight + Play release pipelines, so/ar localization experience, live driver/rider network | The payment core of V1 is already proven in production in Ridy +167 |

**Known unknowns:** eDahab merchant USSD syntax (Somtel outreach in Phase 0); whether merchants value a ledger enough to tap "confirm" per sale (the Phase 2 kill question).

---

## 2. Gap list (everything between us and first customer)

Ordered by severity. `[P]` product, `[O]` ops/field, `[R]` risk/legal.

1. **[R] No git commits.** Entire project is an uncommitted working tree on `main`. Fix day 0: initial commit + private GitHub remote.
2. **[P] QR flow pivot.** Current QR flow settles against a Zapp wallet balance. V1 QR must encode a **link, not a balance transfer**: `https://<domain>/m/<merchantCode>` →
   - Any phone camera (no app): opens web page → merchant name + photo (server-resolved) → amount → "Pay with Zaad" → `tel:` dial attempt + copy-code fallback (Ridy pattern).
   - Zapp Pay installed: universal link opens the app instead → same flow with history/receipts.
   - Merchant code resolves server-side and payloads are signed → a swapped sticker shows the wrong merchant name before anyone dials. This is the #1 fraud vector in no-custody mode; it is not optional.
3. **[P] Payment confirmation without being in the money flow.** V1 truth model: payer taps "I've paid" → merchant sees pending entry → merchant taps confirm (they get the Zaad SMS in hand). Honest framing: the ledger is *merchant-confirmed records*, not bank truth. End-of-day reconcile screen (compare vs Zaad SMS list). Android notification-listener auto-capture is a **post-launch opt-in experiment**, never a launch dependency (Play policy risk).
4. **[P] Android productionization — launch-gating, currently skeletal** (`mobile/android/app` contains only `src`): working release builds, signing configs, package IDs, push, App Check, Play listings for **both** apps.
5. **[P] Strip/flag wallet from Zapp Pay:** `custody_enabled` remote-config flag hides balance/top-up/cash-out; onboarding simplifies to phone + name (KYC tiers are a wallet-era concern).
6. **[R] Merchant role security:** self-select `agent_merchant` role must become an **approval flow** (server-set claim after founder verifies the merchant + their Zaad number in person). Daily-limit enforcement is moot with custody off, but role approval is not — fake merchants = QR impersonation.
7. **[P] Somali translations complete in both apps** (launch language; English fallback acceptable, English-only is not).
8. **[O] Merchant kit:** printed QR standee + window sticker ("Zapp Aqbalaa"), 1-page Somali onboarding script, WhatsApp support line.
9. **[P] Web pay page + domain** on Firebase Hosting (start on `.web.app`, buy domain ~$15 when name is settled).
10. **[P] Instrumentation:** scans, page-opens, dials, payer-marks, merchant-confirms, merchant DAU — wired before first merchant, or Phase 2 learns nothing.
11. **[R] Legal-lite (~$300):** one consultation with Hargeisa counsel confirming a no-custody QR/records tool isn't licensable activity + register a local business name. Deferring the license ≠ zero legal footing.
12. **[P] iOS builds** of both apps — secondary (Android carries the market); target TestFlight by Phase 3, App Store later.

---

## 3. Phases

> Dates assume ~12 h/week from the week of **Jul 20, 2026**. Ridy emergencies shift things right — move dates, don't skip gates.

### Phase 0 — Foundations (Wk 1–2 · Jul 20 – Aug 1)
- [ ] `git init` → initial commit → private GitHub remote (day 0, before anything else)
- [ ] Deploy current functions + rules to **staging**; verify auth + QR generate end-to-end in staging
- [ ] Write QR payload spec (1 page: link format, signing, universal-link behavior, versioning) — the one design doc V1 needs
- [ ] Add `custody_enabled` remote-config flag + hide wallet surfaces behind it
- [ ] Send Somtel/eDahab merchant-USSD info request (parallel track, non-blocking)
- [ ] Counsel consultation booked + business-name registration started
- [ ] Domain decision (buy or `.web.app` for pilot)
- **Gate A:** repo safe on GitHub · staging round-trip works · QR spec written

### Phase 1 — Build no-custody V1 (Wk 3–7 · Aug 3 – Sep 4)
**Zapp Pay Merchant:** onboarding → founder-approval flow → signed QR (screen + printable PDF) → pending-payment confirm UX → ledger (day totals, search) → shareable receipt (WhatsApp) → Somali strings.
**Zapp Pay (customer):** scan (or universal link) → merchant name check → amount → USSD dial via remote-config template (port Ridy `config/mobile_money` pattern) → "I've paid" → history/receipts → Somali strings.
**Web:** fallback pay page (camera-scan path for non-app payers).
**Platform:** Android release builds + signing + Play internal track for both apps; push notifications (merchant: "payment marked by payer"); instrumentation events.
- [ ] Real-money test: pay yourself $1 via the full flow on two physical Androids (staging config, real Zaad)
- [ ] Web-fallback test on an iPhone (copy-sheet path)
- **Gate B:** scan → dial → Zaad SMS received → payer mark → merchant confirm → ledger entry, demonstrated with real money, unassisted, on both paths (app + web)

### Phase 2 — Board the first customer (Wk 8–10 · Sep 7 – Sep 25)
- [ ] Shortlist 3 candidate merchants in the GTM corridor (downtown/Jigjiga Yar/university cluster): owner personally reachable, ≥ 30 Zaad payments/day, walkable from each other. Cafés/juice/fast-food profile.
- [ ] White-glove onboard merchant #1: verify Zaad number in person, print kit, 15-min training, WhatsApp support thread. First 90 days free, forever-free base tier messaging (monetization is a Phase-4+ conversation, per GTM pricing section)
- [ ] Daily visit week 1; fix the confirm-UX friction immediately (this is where V1 lives or dies)
- [ ] Seed payers: 25 installs — friends, family, **Ridy drivers** (they already trust your apps); each makes ≥ 1 real payment at merchant #1
- [ ] Onboard merchants #2–3 with lessons applied
- **Gate C = FIRST CUSTOMER BOARDED:** the definition at the top of this file, met and written down (screenshot the ledger, save the merchant quote)
- **Kill/pivot check:** if all 3 merchants stop confirming payments by week 2 despite visits, the ledger-value hypothesis is wrong → stop scaling, decide: payer-side value first (Ridy integration) or jump to Phase 4 early

### Phase 3 — Prove & spread (Wk 11–16 · Sep 28 – Nov 6)
- [ ] Grow to 10–15 merchants in one walkable corridor (density > coverage)
- [ ] Play Store: internal → open beta → public for both apps
- [ ] Wire referral incentives (screens + backend exist) — small, capped
- [ ] Ridy cross-promo: in-app banner ("Ku bixi Zapp" at partner merchants) — your zero-CAC channel
- [ ] iOS TestFlight builds of both apps
- [ ] Weekly KPI review using the GTM dashboard definitions (scans→dial conversion, merchant weekly-active %, payments/merchant/day)
- [ ] Build the **traction evidence pack**: volume chart, merchant quotes, corridor map — this is the asset that reopens regulatory and powers the Telesom conversation
- **Gate D:** ≥ 10 weekly-active merchants · ≥ 400 confirmed payments/week · ≥ 60% of pilot merchants active in week 4

### Phase 4 — Decision point (~mid-Nov 2026)
With Gate D evidence, explicitly choose (this is where GTM_ROADMAP.md Phases 0–1 activate):
1. **Start the license + entity track** → unlock wallet, agent network, Stripe diaspora top-ups (the dormant 60% of the codebase)
2. **Telesom partnership push** → merchant API / payment-confirmation feed → ledger becomes bank-truth, online payments possible
3. **Monetize the tool** → paid merchant tier (analytics/multi-staff/exports) only after confirmations are API-grade
Trigger rule: starting the regulatory track before Gate D numbers exist wastes its leverage; starting later wastes the window. Book the counsel follow-up the week Gate D passes.

---

## 4. Budget map (envelope $1k–5k)

| Item | Est. |
|---|---|
| GitHub private, Firebase (Blaze, pilot volumes) | ~$0–10/mo |
| Domain | ~$15 |
| Counsel consult + business-name registration | ~$400 |
| Merchant kits (standee+stickers ×20) | ~$60 |
| Google Play ($25 one-off; Apple $99/yr already held via Ridy) | ~$25 |
| Referral/seeding incentives (Phase 3, capped) | ~$300 |
| Marketing tests (TikTok/FB Somali creative, Phase 3) | ~$200 |
| Contingency | ~$500 |
| **Total planned** | **≈ $1.5k** (rest = reserve) |

## 5. Top risks

| Risk | Mitigation |
|---|---|
| QR-swap fraud (sticker replaced with fraudster's code) | Signed payloads + server-resolved merchant name shown pre-dial + tamper-evident printed kits + in-person Zaad-number verification at onboarding |
| Merchants won't tap "confirm" per sale | Phase 2 kill check; payer-mark + end-of-day reconcile as fallback; notification-listener experiment post-launch |
| Telco reaction | V1 *increases* Zaad volume — friendly framing; approach Telesom with Gate D data, not before; never scrape/automate their channels |
| Solo bandwidth / Ridy collisions | Gates not dates; hard rule: **no wallet-era code is touched until Phase 4** |
| Play Store policy | No SMS permissions in launch builds; USSD via user-initiated dial only |
| eDahab absent at launch | Acceptable (Zaad ~80–90% share); remote-config toggle ready when syntax lands |

## 6. Operating rhythm
- Weekly 30 min: update checkboxes here, log the 3 next-week tasks, glance at KPIs (once live).
- Monthly: revisit GTM_ROADMAP.md (its own instruction) + this file's dates.
- Every decision that changes this plan gets written into it the same day.
