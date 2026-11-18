import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { notifyUser } from "../utils/notifications";
import { normaliseSomaliPhone } from "../portal/groups";
import { requirePortalViewer } from "../portal/viewer";

const { Timestamp } = admin.firestore;
const OWNER = "owner-shop";
const STORE = "store-b";
const OTHER = "other-owner";

const session = (sid: string, shop: string) => ({
  merchantUid: shop,
  active: true,
  browser: "test",
  loginId: "pl_x",
  createdAt: Timestamp.now(),
  expiresAt: Timestamp.fromMillis(Date.now() + 3600_000),
});
const sid = (n: number) => `ps_${String(n).repeat(32).slice(0, 32)}`;
const auth = (s: string, shop: string) => ({ uid: `portal_${s}`, token: { portal: true, portalFor: shop, portalSid: s } });

describe("linked stores", () => {
  let invite: any, respond: any, unlink: any, getStore: any;
  let restore: (() => void) | undefined;
  let db: FakeDb;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const g = await import("../portal/groups");
    invite = test.wrap(g.portalInviteStore);
    respond = test.wrap(g.portalRespondLink);
    unlink = test.wrap(g.portalUnlinkStore);
    getStore = test.wrap((await import("../portal/data")).portalGetStore);
  });
  afterAll(() => test.cleanup());
  afterEach(() => restore?.());

  beforeEach(() => {
    (notifyUser as jest.Mock).mockClear();
    db = fakeFirestore({
      [`users/${OWNER}`]: { accountType: "merchant", fullName: "Hodan", phoneNumber: "+252630000001" },
      [`merchantProfiles/${OWNER}`]: { businessName: "Hodan's Café" },
      [`users/${STORE}`]: { accountType: "merchant", fullName: "Branch", phoneNumber: "+252630000002" },
      [`merchantProfiles/${STORE}`]: { businessName: "Hodan's Café 26 June" },
      [`users/${OTHER}`]: { accountType: "agent_merchant", fullName: "Other", phoneNumber: "+252630000003" },
      ["users/cust"]: { accountType: "customer", fullName: "Amina", phoneNumber: "+252630000009" },
      [`portalSessions/${sid(1)}`]: session(sid(1), OWNER),
      [`portalSessions/${sid(2)}`]: session(sid(2), STORE),
      [`portalSessions/${sid(3)}`]: session(sid(3), OTHER),
    });
    restore = useFakeFirestore(db);
  });

  it("reads Somali numbers however they're typed", () => {
    expect(normaliseSomaliPhone("+252 63 000 0002")).toBe("+252630000002");
    expect(normaliseSomaliPhone("0630000002")).toBe("+252630000002");
    expect(normaliseSomaliPhone("630000002")).toBe("+252630000002");
    expect(normaliseSomaliPhone("00252630000002")).toBe("+252630000002");
    expect(normaliseSomaliPhone("12345")).toBeNull();
  });

  it("links a store only once the store accepts, then the owner sees it", async () => {
    await invite({ data: { phone: "063 000 0002" }, auth: auth(sid(1), OWNER) });
    expect(db.get(`storeLinks/${STORE}`)).toMatchObject({ ownerUid: OWNER, status: "invited", storeName: "Hodan's Café 26 June" });
    expect(notifyUser).toHaveBeenCalledWith(STORE, "store_link", { key: "storelink.invited", params: { owner: "Hodan's Café" } }, { type: "store_link" });

    // Invited is not linked: the owner still sees only their own shop.
    await expect(requirePortalViewer({ auth: auth(sid(1), OWNER) } as any, STORE)).rejects.toMatchObject({ details: { reason: "portal_store_denied" } });
    const pending = (await getStore({ data: {}, auth: auth(sid(2), STORE) })).data;
    expect(pending.links.incoming).toEqual({ ownerName: "Hodan's Café", status: "invited" });

    await respond({ data: { accept: true }, auth: auth(sid(2), STORE) });
    const viewer = await requirePortalViewer({ auth: auth(sid(1), OWNER) } as any, STORE);
    expect(viewer.storeUids).toEqual([OWNER, STORE]);
    const owned = (await getStore({ data: {}, auth: auth(sid(1), OWNER) })).data;
    expect(owned.stores.map((s: any) => s.name)).toEqual(["Hodan's Café", "Hodan's Café 26 June"]);
    expect(owned.links.linked).toEqual([expect.objectContaining({ storeUid: STORE, status: "active" })]);
    // The link never runs the other way.
    await expect(requirePortalViewer({ auth: auth(sid(2), STORE) } as any, OWNER)).rejects.toMatchObject({ details: { reason: "portal_store_denied" } });
  });

  it("lets the store decline, and either side unlink at once", async () => {
    await invite({ data: { phone: "0630000002" }, auth: auth(sid(1), OWNER) });
    await respond({ data: { accept: false }, auth: auth(sid(2), STORE) });
    expect(db.get(`storeLinks/${STORE}`)).toBeUndefined();

    await invite({ data: { phone: "0630000002" }, auth: auth(sid(1), OWNER) });
    await respond({ data: { accept: true }, auth: auth(sid(2), STORE) });
    await unlink({ data: {}, auth: auth(sid(2), STORE) });
    await expect(requirePortalViewer({ auth: auth(sid(1), OWNER) } as any, STORE)).rejects.toMatchObject({ details: { reason: "portal_store_denied" } });

    await invite({ data: { phone: "0630000002" }, auth: auth(sid(1), OWNER) });
    await respond({ data: { accept: true }, auth: auth(sid(2), STORE) });
    await unlink({ data: { storeUid: STORE }, auth: auth(sid(1), OWNER) });
    expect(db.get(`storeLinks/${STORE}`)).toBeUndefined();
  });

  it("refuses customers, itself, a store taken by another owner, and stranger unlinks", async () => {
    await expect(invite({ data: { phone: "0630000009" }, auth: auth(sid(1), OWNER) })).rejects.toMatchObject({ details: { reason: "link_no_shop" } });
    await expect(invite({ data: { phone: "0630000001" }, auth: auth(sid(1), OWNER) })).rejects.toMatchObject({ details: { reason: "link_self" } });
    await invite({ data: { phone: "0630000002" }, auth: auth(sid(1), OWNER) });
    await expect(invite({ data: { phone: "0630000002" }, auth: auth(sid(3), OTHER) })).rejects.toMatchObject({ details: { reason: "link_taken" } });
    await expect(unlink({ data: { storeUid: STORE }, auth: auth(sid(3), OTHER) })).rejects.toMatchObject({ details: { reason: "link_none" } });
    // A linked store can't become an owner of others, nor an owner a member.
    await respond({ data: { accept: true }, auth: auth(sid(2), STORE) });
    await expect(invite({ data: { phone: "0630000003" }, auth: auth(sid(2), STORE) })).rejects.toMatchObject({ details: { reason: "link_owner_is_member" } });
    await expect(invite({ data: { phone: "0630000001" }, auth: auth(sid(3), OTHER) })).rejects.toMatchObject({ details: { reason: "link_store_is_owner" } });
  });
});
