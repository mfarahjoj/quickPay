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

## Hand-over: where this stopped (2026-11-23 ~12:55)

Harness state (may be gone by the time you read this — restart with docs/LOCAL_QA.md):
- Simulator iPhone 16e 89DC611F-939A-4D42-8585-B15D1D9A2C3F has both apps, ZAPP_EMULATOR_HOST=127.0.0.1, RCT_jsLocation customer :8191, merchant :8192.
- Merchant app signed in as the AGENT (Daallo Cash Point, +252634000004), on "Top up a customer → Enter the code" with phone 0634000001 and code 494317 typed, Check not yet pressed.
- Open agent work for Amina (expires 13:22 UTC 23 Nov): top-up request code 494317 ($15), cash-out code 734474 ($5). If expired, recreate: as Amina call customerRequestAgentTopup {amount:1500,currency:'USD'} and customerCashOut {amount:500,pin,currency:'USD'} via scripts/qa/emulator-client.mts `call()`.
- node_modules in this worktree were wiped once by a cleanup elsewhere; `npm ci` in functions/, mobile/, merchant-app/ restores them (no postinstall steps), then restart Metro.

Still to do:
1. Agent: press Check → confirm the $15 top-up (agentConfirmTopup); "Give cash" → confirm cash-out 734474 (agentConfirmCashOut); then "Find the customer by phone" → manual top-up with the reference left BLANK to confirm the server bug (manualTopup writes `reference: undefined` → INTERNAL). Agent screens: Top-ups list, Move to float, float desk views.
2. Re-verify on the simulator: Charge Done → Receive resets; Send default currency; Payroll input clipping; Delete account / Remove colours; customer PaymentConfirm amount size, dispute "Send message" single tap, Cash Out PIN pad without ".".
3. Merchant in so/ar (only English walked), merchant dark mode.
4. Customer KYC submission (photo upload goes to the Storage emulator), Edit profile, Linked accounts/apps, Invite.
5. Listed-not-fixed items above need owners: manualTopup blank reference (money flow), merge fix/qr-expires-at-iso, transaction row titles in so/ar (product rule), language-change confirmation in the old language (PR 44 lines), Insights day names, Arabic RTL (sibling session), scanner fallback without a camera (product).
