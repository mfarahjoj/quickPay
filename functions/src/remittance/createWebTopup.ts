/**
 * Former public web top-up endpoint, switched off (decision D4).
 *
 * It took a phone number from anyone on the internet and answered with the
 * account holder's name (`lookupOnly`), so it worked as a phone-to-name
 * directory of every Zapp user, and it wrote a pending `webTopups` doc for
 * each Stripe intent it created. Stripe is still a stub and `stripeWebhook`
 * refuses everything, so no web top-up could ever complete, and the page that
 * called this now redirects home (`hosting/public/send.html`).
 *
 * It stays exported, answering 503, so the next deploy replaces the live
 * function instead of leaving the old one running. Bring web top-up back only
 * when Stripe is live, and then with a masked name, App Check (reCAPTCHA
 * Enterprise), per-IP and per-phone rate limits, and a `webTopups` write only
 * after a real intent exists. The previous implementation is in git history.
 */
import { https } from "firebase-functions/v2";

export const createWebTopup = https.onRequest(async (_req, res) => {
  res.status(503).json({ success: false, error: "Web top-up is not available" });
});
