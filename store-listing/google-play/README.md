# Google Play graphics: Zapp Pay and Zapp Pay Merchant

These are the store listing assets for both Android apps. Each app has one HTML page that draws every frame, and the two pages share `src/common.css` and `src/common.js`.

| App | Package | Source | Output |
|---|---|---|---|
| Zapp Pay (customer) | `com.quickpay.customer` | `src/customer.html` | `out/customer/` |
| Zapp Pay Merchant | `com.quickpay.merchant` | `src/merchant.html` | `out/merchant/` |

## What goes where in Play Console

| Play Console slot | File (in each app's `out/` folder) | Spec |
|---|---|---|
| App icon | `icon-512.png` | 512×512 PNG, full-bleed square (Play applies its own mask and shadow) |
| Feature graphic | `feature-graphic.png` | 1024×500 PNG, no alpha |
| Phone screenshots, in file-name order | `phone-1-….png` to `phone-7-….png` | 1080×1920 (9:16) PNG, no alpha |

Play shows the first three screenshots in search results, so the strongest ones come first:

- **Customer:** home → scan → PIN → agent top-up → send → insights → languages
- **Merchant:** dashboard → receive QR → payment received → counter code → agent commission → payroll → payout

## Re-render

```bash
./render.sh                    # both apps
./render.sh merchant           # one app
./render.sh customer shot-4    # one frame: shot-1…shot-7, feature, icon
```

This needs Google Chrome in `/Applications`; set `CHROME=` to use another binary. For each file the script prints its size and whether it has an alpha channel, because Play rejects alpha on screenshots and feature graphics.

Chrome sometimes crashes on exit after writing the image, so the script checks that the file exists rather than relying on Chrome's exit code.

To preview while editing, open `src/merchant.html#shot-2` (or any frame) in Chrome.

## Keeping it honest

Play requires screenshots to show the real in-app experience, so the phone UI is redrawn from the real screens:

- **Customer:** `DashboardScreen`, `ScanQRScreen`, `PaymentConfirmScreen` (`PinInput` with the number pad), `AgentTopupScreen`, `PaymentsScreen` (amount step), `InsightsScreen`, `LanguageSelector`
- **Merchant:** `DashboardScreen`, `GenerateQRScreen` (showing, paid and counter states, plus `CounterIncomingFeed`), `ConfirmTopupScreen` (success), `PayrollScreen` (review), `PayoutScreen`

All copy comes from each app's `src/i18n/locales/en.json`, and the Somali frame uses `so.json`. If a screen changes, update its frame here.

Fee and commission figures follow the defaults in `functions/src/config/rates.ts`: a 1% payment fee ($15.00 → $14.85) and a 2% top-up commission ($20.00 → $0.40). If prod `config/rates` differs, change the numbers in `merchant.html`.

The merchant listing frame uses the website's blue business look (`#1A56FF`) so the two listings read apart. The phone UI keeps the app's real colours: black glass with a coral accent. Both apps' icons, and the logo tile on the merchant feature graphic, are the same coral bolt.

The QR codes encode `https://zapppay.web.app`, and the people and shops are made up.

Play metadata policy bans rankings, "free", "#1", "download now" and price or promo claims in graphics. None of these frames uses them, and new copy shouldn't either.
