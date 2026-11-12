import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { decrypt } from "../utils/encryption";
import { ENCRYPTION_KEY, PIN_PEPPER } from "../config/secrets";
import { Provider } from "./core";
import { parseOperatorSms } from "./parsers";
import { LISTENER_DEVICES, LISTENER_SMS, processReceipt } from "./receipts";
import { COLLECTION_CONFIG } from "./linking";

/**
 * Whether [header] (`t=<unix seconds>,v1=<hex>`) is HMAC-SHA256 of
 * `"<t>.<raw body>"` under [key], within [toleranceSeconds] of [nowMs].
 */
export function verifyListenerSignature(
  header: string | undefined,
  rawBody: Buffer | string,
  key: string,
  nowMs: number,
  toleranceSeconds = 300
): boolean {
  if (!header || !key) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowMs / 1000 - t) > toleranceSeconds) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const want = Buffer.from(crypto.createHmac("sha256", key).update(`${t}.${body}`).digest("hex"), "hex");
  const given = Buffer.from(String(parts.v1 || ""), "hex");
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Whether [from] is one of the operator's official sender IDs for [provider]. */
export function isOperatorSender(from: string, senderIds: unknown): boolean {
  if (!Array.isArray(senderIds) || senderIds.length === 0) return false;
  const norm = (s: string) => s.trim().toLowerCase();
  return senderIds.some((id) => typeof id === "string" && norm(id) === norm(from));
}

/**
 * The listener phone: forwards each SMS the collection SIM receives, and a
 * heartbeat. Body: `{ type: "sms", smsId, from, body, receivedAt }` or
 * `{ type: "heartbeat" }`. Headers: `Listener-Device`, `Listener-Signature`.
 *
 * Only SMS from the operator's official sender IDs (config/collection
 * `{provider}.senderIds`) are read; anything else is kept and ignored.
 */
export const mobileMoneyListener = https.onRequest(
  { secrets: [ENCRYPTION_KEY, PIN_PEPPER], invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const deviceId = String(req.get("Listener-Device") ?? "");
    const db = admin.firestore();
    const deviceSnap = deviceId && /^ld_[A-Za-z0-9_-]+$/.test(deviceId)
      ? await db.collection(LISTENER_DEVICES).doc(deviceId).get()
      : null;
    if (!deviceSnap?.exists || deviceSnap.get("active") !== true) {
      res.status(401).send("Unknown device");
      return;
    }
    let key: string;
    try {
      key = decrypt(deviceSnap.get("keyEncrypted"));
    } catch {
      res.status(500).send("Device key unreadable");
      return;
    }
    if (!verifyListenerSignature(req.get("Listener-Signature"), req.rawBody, key, Date.now())) {
      res.status(401).send("Bad signature");
      return;
    }
    const provider = deviceSnap.get("provider") as Provider;
    await deviceSnap.ref.update({ lastSeenAt: admin.firestore.Timestamp.now() });

    const body = req.body ?? {};
    if (body.type === "heartbeat") {
      res.status(200).json({ ok: true });
      return;
    }
    if (body.type !== "sms" || typeof body.smsId !== "string" || typeof body.body !== "string") {
      res.status(400).send("Expected an sms");
      return;
    }

    const smsRef = db.collection(LISTENER_SMS).doc(`${deviceId}_${body.smsId.replace(/[^A-Za-z0-9_-]/g, "")}`);
    const receivedAtMs = Number.isFinite(body.receivedAt) ? Number(body.receivedAt) : Date.now();
    const config = (await db.doc(COLLECTION_CONFIG).get()).get(provider) ?? {};
    const fromOperator = isOperatorSender(String(body.from ?? ""), config.senderIds);

    try {
      await smsRef.create({
        deviceId,
        provider,
        from: String(body.from ?? "").slice(0, 40),
        body: body.body.slice(0, 1000),
        receivedAt: admin.firestore.Timestamp.fromMillis(receivedAtMs),
        status: fromOperator ? "received" : "ignored",
        createdAt: admin.firestore.Timestamp.now(),
      });
    } catch (error: any) {
      if (error?.code === 6) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      throw error;
    }
    if (!fromOperator) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const payment = parseOperatorSms(provider, body.body, receivedAtMs);
    if (!payment) {
      await smsRef.update({ status: "unparsed" });
      res.status(200).json({ ok: true, unparsed: true });
      return;
    }
    try {
      const outcome = await processReceipt({ ...payment, provider });
      await smsRef.update({ status: "processed", receiptId: outcome.receiptId, outcome: outcome.status });
      res.status(200).json({ ok: true, ...outcome });
    } catch (error) {
      console.error("mobile money listener: processing failed", error);
      await smsRef.update({ status: "failed" });
      // 500 makes the listener retry; the receipt is idempotent.
      res.status(500).send("Try again");
    }
  }
);
