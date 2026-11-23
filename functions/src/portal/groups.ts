/**
 * Linked stores (MERCHANT_INSIGHTS.md, Phase 3): an owner with several shops
 * sees them together in Zapp Business. Each shop keeps its own merchant
 * account, wallet and payouts; linking only lets the owner's Zapp Business
 * sessions read the shop's figures (merchantStats), never move its money.
 *
 *   owner  portalInviteStore  → by the shop's Zapp phone number; the shop gets a push
 *   shop   portalRespondLink  → from its own Zapp Business session (signed in
 *                               with that shop's phone and PIN): accept or decline
 *   either portalUnlinkStore  → ends it at once
 *
 * `storeLinks/{storeUid}` holds the one link a shop can be in. Server-only;
 * the rules read it to let the owner's session see an active member.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { MERCHANT_TYPES } from "../counterDisplay/guard";
import { shopName } from "../counterDisplay/state";
import { notifyUser } from "../utils/notifications";
import { requirePortalViewer } from "./viewer";

export const STORE_LINKS = "storeLinks";
/** Stores an owner may have linked or invited at once. */
export const MAX_LINKED_STORES = 20;

export type LinkStatus = "invited" | "active";

/** `storeLinks/{storeUid}`. */
export interface StoreLink {
  ownerUid: string;
  storeUid: string;
  status: LinkStatus;
  ownerName: string;
  storeName: string;
  invitedAt: Timestamp;
  acceptedAt?: Timestamp;
}

/** Shops whose figures this owner may read: active links only. */
export async function linkedStoreUids(ownerUid: string): Promise<string[]> {
  const snap = await admin
    .firestore()
    .collection(STORE_LINKS)
    .where("ownerUid", "==", ownerUid)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((d) => d.id);
}

async function nameOf(uid: string): Promise<{ name: string; accountType?: string }> {
  const db = admin.firestore();
  const [u, p] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("merchantProfiles").doc(uid).get()]);
  return { name: shopName(u.data(), p.data()), accountType: u.data()?.accountType };
}

/** "+252 63 123 4567", "0631234567", "631234567" → "+252631234567". */
export function normaliseSomaliPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("252")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^\d{9}$/.test(d) ? `+252${d}` : null;
}

export const portalInviteStore = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ phone?: unknown }>) => {
    const viewer = await requirePortalViewer(request);
    // Linking stores is the shop's own call, never a staff member's.
    if (viewer.role !== "owner") throw new https.HttpsError("permission-denied", "Only the shop's own account can link stores.", { reason: "portal_owner_only" });
    const ownerUid = viewer.merchantUid;
    const phone = normaliseSomaliPhone(request.data?.phone);
    if (!phone) throw new https.HttpsError("invalid-argument", "Enter the shop's Zapp phone number.", { reason: "link_bad_phone" });

    const db = admin.firestore();
    const found = await db.collection("users").where("phoneNumber", "==", phone).limit(2).get();
    const shop = found.docs.find((d) => MERCHANT_TYPES.includes(d.data().accountType));
    if (!shop) throw new https.HttpsError("not-found", "No Zapp shop uses that number.", { reason: "link_no_shop" });
    const storeUid = shop.id;
    if (storeUid === ownerUid) throw new https.HttpsError("invalid-argument", "That's this shop.", { reason: "link_self" });

    // An owner's own shop can't also be someone else's linked store, and vice versa.
    const [ownLink, existing] = await Promise.all([
      db.collection(STORE_LINKS).doc(ownerUid).get(),
      db.collection(STORE_LINKS).where("ownerUid", "==", ownerUid).get(),
    ]);
    if (ownLink.exists) {
      throw new https.HttpsError("failed-precondition", "This shop is linked to another owner.", { reason: "link_owner_is_member" });
    }
    if (existing.size >= MAX_LINKED_STORES) {
      throw new https.HttpsError("resource-exhausted", `Up to ${MAX_LINKED_STORES} stores.`, { reason: "link_limit" });
    }
    const [owner, store] = await Promise.all([nameOf(ownerUid), nameOf(storeUid)]);

    const ref = db.collection(STORE_LINKS).doc(storeUid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const link = snap.data() as StoreLink | undefined;
      if (link && link.ownerUid !== ownerUid) {
        throw new https.HttpsError("failed-precondition", "That shop is already linked to another owner.", { reason: "link_taken" });
      }
      if (link?.status === "active") {
        throw new https.HttpsError("already-exists", "That shop is already linked.", { reason: "link_exists" });
      }
      const ownerAsMember = await tx.get(db.collection(STORE_LINKS).where("ownerUid", "==", storeUid).limit(1));
      if (!ownerAsMember.empty) {
        throw new https.HttpsError("failed-precondition", "That shop has stores of its own linked.", { reason: "link_store_is_owner" });
      }
      const next: StoreLink = {
        ownerUid,
        storeUid,
        status: "invited",
        ownerName: owner.name,
        storeName: store.name,
        invitedAt: Timestamp.now(),
      };
      tx.set(ref, next);
    });

    notifyUser(storeUid, "store_link", { key: "storelink.invited", params: { owner: owner.name } }, { type: "store_link" }).catch((err) =>
      console.error("Store link push failed:", err)
    );
    return { success: true, data: { storeUid, storeName: store.name, status: "invited" } };
  }
);

export const portalRespondLink = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ accept?: unknown }>) => {
    const viewer = await requirePortalViewer(request);
    // Linking stores is the shop's own call, never a staff member's.
    if (viewer.role !== "owner") throw new https.HttpsError("permission-denied", "Only the shop's own account can link stores.", { reason: "portal_owner_only" });
    const storeUid = viewer.merchantUid;
    const ref = admin.firestore().collection(STORE_LINKS).doc(storeUid);
    const accept = request.data?.accept === true;
    const link = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const l = snap.data() as StoreLink | undefined;
      if (!l || l.status !== "invited") {
        throw new https.HttpsError("not-found", "No request to link this shop.", { reason: "link_none" });
      }
      if (accept) tx.update(ref, { status: "active", acceptedAt: Timestamp.now() });
      else tx.delete(ref);
      return l;
    });
    if (accept) {
      notifyUser(link.ownerUid, "store_link", { key: "storelink.accepted", params: { store: link.storeName } }, { type: "store_link" }).catch(
        (err) => console.error("Store link push failed:", err)
      );
    }
    return { success: true, data: { status: accept ? "active" : "declined" } };
  }
);

/** The owner removes a store, or a store leaves: either side, at once. */
export const portalUnlinkStore = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ storeUid?: unknown }>) => {
    const viewer = await requirePortalViewer(request);
    // Linking stores is the shop's own call, never a staff member's.
    if (viewer.role !== "owner") throw new https.HttpsError("permission-denied", "Only the shop's own account can link stores.", { reason: "portal_owner_only" });
    const target = typeof request.data?.storeUid === "string" ? request.data.storeUid : viewer.merchantUid;
    if (target.includes("/")) throw new https.HttpsError("invalid-argument", "storeUid is required");
    const ref = admin.firestore().collection(STORE_LINKS).doc(target);
    const snap = await ref.get();
    const link = snap.data() as StoreLink | undefined;
    if (!link || (link.ownerUid !== viewer.merchantUid && link.storeUid !== viewer.merchantUid)) {
      throw new https.HttpsError("not-found", "That store isn't linked.", { reason: "link_none" });
    }
    await ref.delete();
    return { success: true, data: { unlinked: target } };
  }
);

/** For portalGetStore: the stores this owner links, and any request waiting for this shop. */
export async function linksFor(merchantUid: string) {
  const db = admin.firestore();
  const [mine, incoming] = await Promise.all([
    db.collection(STORE_LINKS).where("ownerUid", "==", merchantUid).get(),
    db.collection(STORE_LINKS).doc(merchantUid).get(),
  ]);
  const inc = incoming.data() as StoreLink | undefined;
  return {
    linked: mine.docs.map((d) => {
      const l = d.data() as StoreLink;
      return { storeUid: l.storeUid, storeName: l.storeName, status: l.status, invitedAtMs: l.invitedAt.toMillis() };
    }),
    incoming: inc ? { ownerName: inc.ownerName, status: inc.status } : null,
  };
}
