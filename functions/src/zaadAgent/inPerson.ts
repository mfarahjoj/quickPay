/**
 * Zaad paid to an agent in person (ZAPP_AGENT_TOPUP_ONE_FLOW_PLAN.md, D19).
 *
 * The customer asks for a top-up and shows their code, as for cash
 * (customerRequestAgentTopup). The agent scans it (previewAgentTopup) and,
 * instead of taking cash, chooses Zaad. That moves the cash-in request to a
 * Zaad request: the agent's float is held for the customer at once (D3), and
 * from there it is the same flow as a remote Zaad top-up. The customer pays
 * the agent's ops-checked number (D20); the agent confirms with their PIN
 * when the Zaad lands; disputes, the sweep and ops work as for remote.
 *
 * The differences from remote: no dispatch (the scan chose the agent), the
 * Zaad transaction ID is optional (D21), and the request doesn't take the
 * agent's one-request-at-a-time slot (D26): it never sets openRequestId, so
 * remote offers and in-person top-ups don't block each other.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { getRates } from "../config/rates";
import { readFloatCents } from "../agents/float";
import { prepareJournalEntry } from "../ledger";
import { formatAmount, pushAmount } from "../utils/money";
import { notifyUser } from "../utils/notifications";
import { dialCode } from "../mobileMoney/linking";
import { LINKED_NUMBERS } from "../mobileMoney/receipts";
import { storedCurrency } from "../topup/agentCurrency";
import {
  agentDisplayName,
  assertNamesOneRequest,
  assertTarget,
  requireActiveAgent,
  verifyTopupCode,
  TopupTarget,
} from "../topup/agentConfirmTopup";
import { ApiResponse, AgentTopupRequest } from "../types";
import { displayMsisdn, firstName, holdEntry, holdEntryId, maskMsisdn } from "./core";
import { assertNoActiveZaad, assertZaadAgentOpen, assertZaadAmount, checkZaadCustomer } from "./limits";
import { ZAAD_AGENTS, ZAAD_AGENT_TOPUPS, ZaadAgentDoc, ZaadAgentTopup } from "./types";

interface StartRequest extends TopupTarget {
  /** The amount the agent was shown by previewAgentTopup, in US cents. */
  expectedAmount: number;
}

export interface InPersonStarted {
  /** The Zaad request the top-up continues as (zaadAgentTopups/{id}). */
  requestId: string;
  amount: number;
  customerName: string;
  /** Masked, for checking against the sender in the agent's Zaad text (D5). */
  allowedSenders: string[];
  sendBy: string;
}

/**
 * Agent: the customer in front of me will pay by Zaad. In: the same target as
 * previewAgentTopup (`requestId` from the QR, or `customerPhone` with
 * `otpCode`) and `expectedAmount`. No PIN: this only sets the agent's own
 * float aside; paying it to the customer (agentConfirmZaadTopup) takes it.
 */
export const agentStartZaadInPerson = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<StartRequest>): Promise<ApiResponse<InPersonStarted>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;
    const data = request.data ?? ({} as StartRequest);
    assertTarget(data);
    assertNamesOneRequest(data);

    const rates = await getRates();
    assertZaadAgentOpen(rates);

    const db = admin.firestore();
    const agentUser = await requireActiveAgent(db, agentId, "take Zaad");
    const zaadRef = db.collection(ZAAD_AGENTS).doc(agentId);
    const zaad = (await zaadRef.get()).data() as ZaadAgentDoc | undefined;
    if (!zaad?.enabled || !zaad.receiveMsisdn) {
      throw new https.HttpsError(
        "failed-precondition",
        "Zapp Pay needs to check your Zaad number in person before you can take Zaad. Take cash instead.",
        { reason: "zaad_not_set_up" }
      );
    }
    if (zaad.pausedUntil && zaad.pausedUntil.toMillis() > Date.now()) {
      throw new https.HttpsError("failed-precondition", "Your Zaad number changed recently. Take cash for now.", {
        reason: "paused",
        pausedUntil: zaad.pausedUntil.toDate().toISOString(),
      });
    }

    // A retry of a start that went through (the reply was lost): the code is
    // used now, so answer with the Zaad request it became.
    if (typeof data.requestId === "string") {
      const prior = (await db.collection("agentTopupRequests").doc(data.requestId).get()).data() as
        | AgentTopupRequest
        | undefined;
      if (prior?.status === "moved_to_zaad" && prior.zaadRequestId) {
        const z = (await db.collection(ZAAD_AGENT_TOPUPS).doc(prior.zaadRequestId).get()).data() as
          | ZaadAgentTopup
          | undefined;
        if (z?.agentId === agentId) {
          return {
            success: true,
            data: {
              requestId: prior.zaadRequestId,
              amount: z.amount,
              customerName: z.customerFirstName,
              allowedSenders: (z.allowedSenders ?? []).map(maskMsisdn),
              sendBy: (z.sendBy ?? admin.firestore.Timestamp.now()).toDate().toISOString(),
            },
          };
        }
      }
    }

    // The same resolver and wrong-code counting as the cash scan.
    const { ref: cashRef, topup, customerName } = await verifyTopupCode(db, agentId, data);
    if (storedCurrency(topup.currency) !== "USD") {
      throw new https.HttpsError(
        "failed-precondition",
        "Zaad top-ups are in dollars. Take cash for shillings.",
        { reason: "zaad_dollars_only" }
      );
    }
    if (data.expectedAmount !== topup.amount) {
      throw new https.HttpsError(
        "failed-precondition",
        "The customer asked for a different amount than the one you were shown. Scan their code again.",
        { reason: "amount_mismatch" }
      );
    }
    assertZaadAmount(topup.amount, rates);
    const nowMs = Date.now();
    const { user: customer, customerRef } = await checkZaadCustomer(topup.customerId, topup.amount, rates, nowMs);

    const linked = await db
      .collection(LINKED_NUMBERS)
      .where("uid", "==", topup.customerId)
      .where("provider", "==", "zaad")
      .where("status", "==", "verified")
      .limit(1)
      .get();
    const allowedSenders = [
      ...new Set([customer.phoneNumber, ...linked.docs.map((d) => d.get("msisdn") as string)].filter(Boolean)),
    ] as string[];

    const zaadReqRef = db.collection(ZAAD_AGENT_TOPUPS).doc();
    const agentName = agentDisplayName(agentUser);
    const sendBy = admin.firestore.Timestamp.fromMillis(nowMs + rates.zaadAgentSendMinutes * 60_000);
    let movedTo: string | null = null;
    let lowFloat: number | null = null;

    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(cashRef)).data() as AgentTopupRequest | undefined;
      // Started twice on one scan (a retry): carry on with the first.
      if (fresh?.status === "moved_to_zaad" && fresh.zaadRequestId) {
        movedTo = fresh.zaadRequestId;
        return;
      }
      if (!fresh || fresh.status !== "pending" || fresh.expiresAt.toMillis() < nowMs) {
        throw new https.HttpsError("failed-precondition", "This code was already used or has expired", {
          reason: "not_pending",
        });
      }
      await assertNoActiveZaad(tx, customerRef);
      // Free float: anything already held for other top-ups has left agent:{uid}.
      const float = await readFloatCents(agentId, tx);
      if (float < topup.amount) {
        lowFloat = float;
        return;
      }
      const prepared = await prepareJournalEntry(tx, holdEntry(zaadReqRef.id, agentId, topup.amount));
      prepared.write(tx);

      const now = admin.firestore.Timestamp.fromMillis(nowMs);
      const record: ZaadAgentTopup = {
        customerId: topup.customerId,
        customerFirstName: firstName(customer.fullName),
        amount: topup.amount,
        currency: "USD",
        meeting: "in_person",
        status: "accepted",
        createdAt: now,
        updatedAt: now,
        deadlineAt: sendBy,
        offers: [],
        offeredTo: null,
        offerExpiresAt: null,
        agentId,
        agentName,
        agentReceiveMsisdn: zaad.receiveMsisdn!,
        dialCode: dialCode("zaad", zaad.receiveMsisdn!, topup.amount, "USD"),
        allowedSenders,
        acceptedAt: now,
        sendBy,
        holdEntryId: holdEntryId(zaadReqRef.id),
      };
      tx.set(zaadReqRef, record);
      tx.set(customerRef, { activeRequestId: zaadReqRef.id }, { merge: true });
      tx.update(cashRef, { status: "moved_to_zaad", zaadRequestId: zaadReqRef.id, scannedByName: agentName });
      movedTo = zaadReqRef.id;
    });

    if (lowFloat !== null) {
      throw new https.HttpsError(
        "failed-precondition",
        `Insufficient float. This top-up needs ${formatAmount(topup.amount, "USD")} but your float is ${formatAmount(lowFloat, "USD")}.`,
        { reason: "insufficient_float", floatCents: lowFloat, currency: "USD" }
      );
    }
    const id = movedTo as string | null;
    if (!id) throw new https.HttpsError("internal", "Could not start the Zaad top-up");
    const started = (await db.collection(ZAAD_AGENT_TOPUPS).doc(id).get()).data() as ZaadAgentTopup;

    notifyUser(
      topup.customerId,
      "zaad_agent_topup",
      {
        key: "zaadAgent.accepted",
        params: {
          agent: started.agentName ?? agentName,
          amount: pushAmount(started.amount, "USD"),
          number: displayMsisdn(started.agentReceiveMsisdn ?? ""),
          minutes: String(rates.zaadAgentSendMinutes),
        },
      },
      { type: "zaad_agent_accepted", requestId: id }
    ).catch((err) => console.error("zaadAgent notify failed:", err));

    return {
      success: true,
      data: {
        requestId: id,
        amount: started.amount,
        customerName,
        allowedSenders: (started.allowedSenders ?? []).map(maskMsisdn),
        sendBy: (started.sendBy ?? sendBy).toDate().toISOString(),
      },
    };
  }
);
