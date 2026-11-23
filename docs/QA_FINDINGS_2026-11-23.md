# Running findings (customer = C, merchant = M)
- C/M ConsentGate: no side padding (iOS SafeAreaView drops padding) — FIXED both apps (inner View). Screens c10 (before), c11 (after).
- (dropped) Login 'first tap only dismisses keyboard': my tap landed on the on-screen keyboard; both logins already persist taps.
- Server: manualTopup writes `reference: undefined` when blank → Firestore rejects → INTERNAL. Money flow, not changed. Merchant app omits blank reference. Verify in M Top up.
- Dev: navigation params carry non-serializable OTP confirmation object (React Navigation warning) — low
- Harness: firebase-tools 15.32 emulator drops admin.firestore statics → shim.
- C Button (gradient variant, 8 screens): label ~28pt right of centre, gradient inset 28-56pt, blue #0066FF glow clipped square under coral — FIXED (Button.tsx). c13 before, c14 after.
- C Home 'Spent · 7 days' added SLS whole shillings as dollars ($25034.50, no comma) — FIXED (utils/spending.ts USD only + formatMajor; test added). c15 before, c16 after. Check Insights for same.
- C Notifications: first two opens after sign-in showed "No notifications yet" though 12 existed; after Fast Refresh remount, all 12 listed. useNotifications sets loading=false before first snapshot (empty-state flash). Investigate repro after relaunch.
- C Notifications: tap only marks read; no deep link to bill/transaction (product). Server copy "You paid USD 8.00"/"SLSH 25,000" vs app "$8.00"/"25,000 SLSH" (pushTemplates).
- Dev only: full JS reload can SIGABRT in -[ReanimatedModule installTurboModule] (QuickPay-2026-11-23-053535.ips); relaunch the app. Typing with no focused field triggered a reload.
- C Scan QR: no manual-entry / photo fallback; on a phone with no working camera you can't pay (product). Added emulator-only "QA · Enter QR payload" to QrScannerView + scripts/qa/qr.mts.
- C PaymentConfirm: amount shrunk to a few px (adjustsFontSizeToFit, no definite width) — FIXED (alignSelf stretch + textAlign center). c28b before. Verify after.
- C useNotifications: loading=false before first snapshot → empty-state flash — FIXED.
- C Pay flow sticker → EnterAmount → Confirm → Success works end to end (payMerchant 200, receipt ZP-MF1J-DHEN). c27, c30.
- Dev: Fast Refresh disconnects every couple of minutes; edits need relaunch.
- C Home: balance is live (listener) but activity list + Spent card fetched once on mount → after paying, Home showed new balance over old list/total until pull-to-refresh — FIXED (refetch when wallet.lastTransactionAt moves). c34 before, c35 after (incoming $1 appears live).
- Harness: iOS Firestore SDK's socket to the emulator goes CLOSED after a few idle minutes and doesn't reconnect until app foregrounds (all listeners stale). Background+foreground or relaunch. Production unaffected (different endpoint) — document.
- C Payments/Send: "Available" balance stale only because of the above. Continue button below the fold on 6.1" (scroll needed) — minor.
- C PinKeypad (app lock, PIN login, setup, reset): error line rendered in flow → keys jump down on error and back up on next press → quick retry mis-taps (reproduced: wrong PIN sent). FIXED (error overlaid in the gap). Also 'Please try again.' gives no attempts-left hint (product/copy).
- C History: dead "S" search placeholder (no onPress) — REMOVED; search is product. Double title (navigator bar + own large title) — FIXED (headerShown false + top inset, same pattern PR 44 uses for Payments). Payments double title already fixed in PR 44 (not in release/zapp-91).
- C TransactionDetail: "Recipient" showed description (P2P with note → "Recipient: Lunch") — FIXED (counterpartyName).
- C/M 13 ScrollViews in input screens lacked keyboardShouldPersistTaps → first tap on Send/Pay/Save only dismisses keyboard (reproduced on Dispute "Send message") — FIXED in 11 customer + Payroll(2) merchant. Not touched (PR 44 files): PaymentsScreen, EditProfile, AgentLocator FlatLists, SendRemittance, MobileMoney, Login country FlatList; merchant TopupCustomer country FlatList.
- C Dispute detail: loads, Withdraw/Send work; with keyboard up the Send button is below the fold (scroll) — ok after fix.
- History titles use server English descriptions ("Manual top-up by agent (cash)", "QR payment") — untranslated in so/ar; product/server (transaction kind labels exist? check).
- C Disputes: every amount formatted as USD cents (disputes/shared money) though disputes carry currency → SLS 25,000 dispute would show "$250.00" — FIXED (Dispute.currency + money(amount,currency); getDisputeOptions now also returns currency: functions change, read-only field, NOT deployed).
- C Limits: "$5000.00"/"$4958.62" no thousands separator — FIXED (formatMajor). Same hand-built dollar strings remain in Invite, ManualTopup, MobileMoney, ResetPin, MerchantScan (lose the separator from $1,000) — listed.
- C Button outline/darkGhost: two-line label left-aligned ("Verify Identity to Increase Limits") — FIXED (textAlign center). c49.
- C Profile badge "KYC: Pending" for an account that never submitted (KYC screen says "Not Submitted") — FIXED (pending → kyc.status.notSubmitted). c53, c68.
- C Cash Out PIN pad shows a dead "." key — FIXED (hidden on PIN step). Code boxes blue (merchant accent) — FIXED coral. c57, c58. customerCashOut end to end OK (code 809924).
- C Find Agent: area chips stretched into half-screen pills (horizontal FlatList grows) — FIXED (flexGrow 0); blue merchant tints → coral. Seed gave the agent no area → added setupAgentProfile step. c61 before, c62 after.
- C Insights: mixed SLS into dollars (Money In $400,161.00, Hodan $25,010.00), no separators, "$25038.\n25" wrap, back label "MainTabs" — FIXED (USD only, formatMajor, minWidth 72, headerBackTitleVisible false on main stack). c63 before, c64 after. Day names 'Sun'..'Sat' and 'Today' (line 77) hard-coded English in both branches — listed (PR 44 adds insights.today; locale files busy in sibling sessions).
- C Language switch confirmation shows in the PREVIOUS language (stale t after applyLanguage): en→so shows English, so→ar shows Somali. Fix: i18n.t() after the switch. PR 44 rewrote these lines → listed, not edited. c66, c69.
- C Arabic: strings translated but layout stays LTR on release/zapp-91 (RTL work is the sibling session's). c69.
- C so/ar: transaction rows show English server descriptions ("Cash-out — show your code", "Payment to Hargeisa Coffee House"); wallet.kind.* labels exist. Needs a product rule for row titles (note for P2P, counterparty or kind label otherwise). c66.
- Tech debt: RNFB namespaced API deprecated (warns on every call; removal in next major). Nav state holds non-serializable OTP confirmation.

## Merchant app (second pass)

- M Dashboard: greeting used the business name's first word ("Hargeisa"), English "Merchant" fallback, "Q" initial — FIXED (full name). Hero gradient ended in a hard seam behind the second row of buttons — FIXED (Wallpaper keyed on header height). "Disputes waiting for your reply" banner see-through over the red hero, unreadable — FIXED (opaque surface). m08 before, m10 after.
- M Receive/charge QR drawn white on white in the light theme (colors.ui.onSolid is #FFFFFF there): nothing to scan — FIXED to black on white; same in CounterCodeScreen; customer StaticMerchantQR had the reverse (black on dark bg in dark mode) — FIXED. m13 before, m14 after.
- M Receive countdown "NaN:NaN": already fixed on branch fix/qr-expires-at-iso (4d524b3), NOT merged into release/zapp-91 or PR 44 — merge it.
- M Disputes: same dollars-only formatting as the customer app — FIXED (currency-aware money()).
- M Scan customer → Charge → approve (as Amina, by script) → "Payment Received!" works end to end. Done then went back to the scanner still titled "Charging $6.50", with Receive still holding $6.50: the next customer could be charged for a paid order — FIXED (Done returns to Receive with saleDone, which starts a new sale; cash-out still pops). NOT yet re-verified on the simulator.
- M Send: always opened on Shillings ("Available: 0 SLSH" for a dollars-only shop) — FIXED (defaults to the currency held; user pick sticks). Not re-verified.
- M Payroll: input text/placeholders clipped at the bottom — FIXED (input fills its 48pt box). Not re-verified. "Remove" employee and Settings "Delete account" used errorSoft (16% tint) as TEXT colour, near invisible — FIXED (colors.ui.error).
- M Welcome screen "Q" logo tile (QuickPay leftover) — FIXED (BrandMarkIcon bolt). Verified.
- M gradient Button: same off-centre label / blue glow bug as customer — FIXED (same change).
- M Withdraw, Bills (list + send form), Staff (empty + add), Settings, API keys (create test key) all work. Notes: Waiter staff role offered before Table Connect exists (product); Settings shows support@zapppay.so (flagged dead in the Play-readiness audit); merchant asks for notification permission straight after OTP, before PIN/consent (customer app defers it).
- M Zaad account gate: customer app prefills the name, merchant doesn't (minor).
- Functions: full suite 1391 passed / 13 failed, all in pinResetSafety.test.ts during a run that overlapped Metro rebuilds; that file passes 18/18 on its own. Only functions change here is getDisputeOptions returning `currency` (+ its type).

## Third pass (2026-11-23 afternoon): agent flows, re-checks, so/ar/dark, splash screens

Screens m40–m71 and c70–c88 in the shared qa-screens folder.

### Agent flows
- M Agent code top-up (agentConfirmTopup) works end to end: preview shows "$15.00 / Amina Warsame", PIN, "Top-Up Confirmed", +$0.30 commission; float $805 → $790. m41–m44.
- M Agent cash-out (agentConfirmCashOut) works: float $790 → $795. m45–m47. **The agent never sees the amount or customer before entering the PIN.** The form is phone + code → PIN → "Cash Out Confirmed $5.00"; the top-up flow has a preview step first (previewAgentTopup). An agent counting out cash learns the amount only after the money moved. Product/server: add a preview like top-up (listed, not changed).
- **Server bug CONFIRMED: manualTopup with a blank reference fails.** `functions/src/topup/manualTopup.ts:289` writes `reference: reference || undefined` into the transaction doc; Firestore rejects it ("Cannot use undefined as a Firestore value (found in field reference)") → 500 INTERNAL → "Top-Up Failed". The app already omits a blank reference, so EVERY manual top-up without a reference fails. The Firestore transaction rolled back: Hodan still $45.00, no journal entry. Fix belongs to the money-flow owner (omit the key, or `null`). Not changed. m48, m50, m51.
- M History: rows formatted every amount as dollars — SLS 400,000 top-up showed "$400,000.00", its 8,000 SLSH commission "+$8,000.00", and the day total added shillings into dollars ("+$4,009,009.20"). FIXED: rows use the row's currency (formatMajor), day totals are per currency ("+$1,009.20 · +4,008,000 SLSH"). m49.
- M History day total counts float movements (float purchases, the cash-out credit to float) and pending payouts as if they were takings, so an agent's "Today" reads +$1,009.20 while net takings are $4.20. What the day total should mean is a product call — listed.
- Server: getTransactionSummary added shilling commission (whole shillings, as cents) into its USD totals — an 8,000 SLSH commission would show as $80.00. FIXED (shilling rows skipped; `incomeCents` exported + `transactionSummaryIncome.test.ts`). Read-only reporting; NOT deployed. Verified on the emulator: summary reads $4.20.
- M History search box: placeholder clipped at the bottom — FIXED (input stretches to the 44pt row). m49.
- M Dashboard Recent Transactions: fetched once, so after a top-up or cash-out it showed the old list under the new balance and float — FIXED (refetch when wallet.lastTransactionAt moves, as the customer Home now does). Rows showed the server description, written from the customer's side ("Top-up from Daallo Cash Point" on the agent's own phone) and English-only — FIXED: counterparty name first, as History does, and the translated kind in the subtitle ("Payment · 23 Nov"). Verified: a $2 top-up run by script appeared live on the open dashboard. m54.
- M Zaad "Top-ups" screen and Buy float with Zaad: header drawn under the status bar; the back chevron sits on the clock and taps there don't register (swipe-back is the only way out) — FIXED (default top safe area; both screens hide the nav header). m52. The screen is titled "Top-ups" but lists only Zaad requests, so an agent with cash top-ups sees an empty page — product/copy.
- M Confirm Cash Out: "Confirm & Pay Cash" footer drawn over the how-to card, which couldn't scroll clear (scroll content `flex: 1`) — FIXED (flexGrow). m45.
- M Top Up Customer by phone: title shown twice (nav bar + large title); amount placeholder slightly clipped at the top — minor, listed.

### Splash screens
- C/M: both apps still had the React Native template launch screen — customer "Zapp Pay" in black system text on white, merchant "Zapp Pay Merchant" + "Powered by React Native". Replaced in both with the brand mark (coral tile, white bolt; SVG in the asset catalog) centred on the app canvas, light #F1F1F4 / dark #000000 (named colour SplashBackground), no text, so nothing untranslated shows at launch. Native change: verified on fresh Debug builds of both apps, light and dark (m60, m61, c70, c71); the splash hands over to the app's loading view on the same colour. Needs a new build to reach testers.

### Re-verified on the simulator (from the hand-over list)
- M Charge → Done returns to Receive, reset to $0 (m56, m57). M Send opens on Dollars, "Available: $19.25" (m55). M Payroll inputs not clipped; remove × in red (m58). M Settings "Delete account" in red (m59).
- C Cash Out PIN step has no "." key (c73). C dispute "Send message" sends on one tap (postDisputeMessage 200, c88); the simulator's hardware keyboard stops the on-screen keyboard appearing, so the keyboard-up case itself is still unverified.
- C PaymentConfirm amount: **the earlier fix did not hold** — "$2.00" still rendered as a dash (c74). adjustsFontSizeToFit shrinks it even with a definite width. FIXED differently: no adjustsFontSizeToFit; `confirmAmountSize(label)` picks 32pt, or 24pt past 11 characters ("1,000,000 SLSH"). Same change on EnterAmount's PIN-confirm box. Test added (utils/__tests__/money.test.ts). Verified (c75).

### Merchant dark mode, Somali, Arabic
- Dark: lock, dashboard, History, Receive look right (m62–m65).
- M OTP screen: title "Verify Your Number" and the phone number used colors.ui.onSolid (button text colour: white in light, black in dark) — invisible in BOTH themes. Same on the login country sheet's title and country names. FIXED (colors.ui.text).
- M language switch confirmed in the previous language (Somali chosen, "Language Changed" in English) — FIXED in merchant LanguageSelector (i18n.t). Verified: Arabic chosen, confirmation in Arabic (m70). The customer app's copy of this bug stays listed (PR 44 lines).
- M Somali: Withdraw action "Lacagtaada qaado" truncated to "Lacagtaada qaa…" — FIXED (action labels wrap to two lines, m67). History filter chips ran off-screen, "Sugitaan" (Pending) unreachable — FIXED (chips wrap). m68.
- M so/ar: dates use the device locale, not the app language ("Nov 23" beside Arabic text) — listed. Arabic language row uses the Saudi flag — product. Settings shows the raw UID ("qa-cafe") — product. Role label truncates after a long business name — minor.

### Customer screens (dark mode)
- C KYC: **submitKYC failed for every submission without the optional back photo** — `backPhotoUrl: backPhotoUrl || undefined` → Firestore rejects → INTERNAL. FIXED in functions/src/auth/submitKYC.ts (key omitted when absent) + submitKYC.test.ts. Not money; NOT deployed. Verified: front + selfie only → "Under Review" (c86).
- C KYC: opening the photo picker locked the app (iOS reported 'background'); the PIN pad went behind the picker and the picked photo never came back to the form (c84). FIXED: `withAppLockPaused()` in hooks/useAppLock.ts wraps the KYC picker/camera calls. Verified: photo returns to the form, no lock (c85).
- C KYC selfie offers "Gallery" as well as Camera, so a stored photo passes as a selfie — compliance/product decision, listed.
- C Invite: the WhatsApp/share message hard-coded "$1" whatever config/rates says — FIXED (bonus from getPricing; no bonus line when referrals are off). Still listed: the message lives in code, not the locale files, with no Arabic (Arabic users get English), and `profile.inviteSubtitle` / `invite.subtitle` hard-code "$1" in all three locale files.
- C Linked Accounts lists Zaad as "Coming soon" directly under a "Zaad account 063 400 0001" row the user just filled in — product/copy.
- C Edit Profile saves (updateProfile 200). Linked apps empty state fine. Date of birth is free text "YYYY-MM-DD" — product.

## Hand-over: where this stopped (2026-11-23 ~14:00)

Harness state: emulators re-seeded 13:05 and running (scripts/qa/emulators.sh); Metro customer :8191, merchant :8192. Simulator 89DC611F has **fresh Debug builds of both apps from this worktree** (built after `pod install` here; Podfile.lock changes from pod install were reverted). Merchant app signed in as Hargeisa Coffee House, language **Arabic** (switch back from the dashboard flag). Customer app signed in as Amina, KYC now "submitted". Simulator in light mode.

Changed this pass (uncommitted): merchant History, Dashboard, OTP, Login, LanguageSelector, ConfirmCashOut, ZaadTopups, BuyFloatZaad; customer PaymentConfirm, EnterAmount, utils/money (+test), useAppLock, KYCScreen, InviteScreen; functions getTransactionSummary (+test), submitKYC (+test); both apps' LaunchScreen.storyboard + SplashMark/SplashBackground assets. Nothing deployed.

Needs an owner (not changed here):
1. **manualTopup blank reference → INTERNAL** (functions/src/topup/manualTopup.ts:289). Money flow. Every manual top-up without a reference fails today.
2. Agent cash-out has no preview of amount/customer before the PIN (top-up has one).
3. Merchant History day total counts float movements and pending payouts as takings.
4. Zaad "Top-ups" screen title vs content; Linked Accounts "Coming soon" vs the Zaad account row.
5. KYC selfie from gallery.
6. Locale-file items held back while other branches edit those files: Invite share text (no Arabic), hard-coded "$1" in invite strings, customer language-change confirmation (PR 44), Insights day names, English server descriptions as row titles in so/ar, device-locale dates.
7. From the earlier pass: merge fix/qr-expires-at-iso; Arabic RTL (sibling session); scanner fallback without a camera.
8. Not walked yet: merchant light-mode Somali beyond dashboard/History/Settings; customer app in so/ar this pass; dispute send with the on-screen keyboard up (needs a device or the simulator's hardware keyboard disconnected).
