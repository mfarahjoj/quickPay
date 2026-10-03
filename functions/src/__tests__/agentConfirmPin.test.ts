import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedVerifyPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const AGENT = "agent-1";

/** Just enough Firestore for the guards that run before the ledger. */
function fakeDbWithAgent(agent: Record<string, unknown>) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => agent }),
      }),
    }),
    runTransaction: jest.fn(),
  } as any;
}

describe("agent confirmations require the agent's PIN", () => {
  let confirmTopup: any;
  let confirmCashOut: any;
  let firestoreSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    confirmTopup = test.wrap((await import("../topup/agentConfirmTopup")).agentConfirmTopup);
    confirmCashOut = test.wrap(
      (await import("../topup/agentConfirmCashOut")).agentConfirmCashOut
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifyPin.mockResolvedValue(true);
  });

  afterEach(() => firestoreSpy?.mockRestore());
  afterAll(() => test.cleanup());

  const cases: Array<[string, () => any]> = [
    ["agentConfirmTopup", () => confirmTopup],
    ["agentConfirmCashOut", () => confirmCashOut],
  ];

  describe.each(cases)("%s", (_name, fn) => {
    it("refuses a call with no PIN", async () => {
      await expect(
        fn()({ data: { otpCode: "123456" }, auth: { uid: AGENT } })
      ).rejects.toThrow(/PIN is required/i);
    });

    it("refuses a wrong PIN before touching the agent's float", async () => {
      mockedVerifyPin.mockResolvedValue(false);
      const db = fakeDbWithAgent({
        accountType: "agent_merchant",
        isActive: true,
      });
      firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);

      await expect(
        fn()({
          // cashOutId: cash-out confirmations must name the request (from the
          // customer's QR); top-up ignores it.
          data: { otpCode: "123456", agentPin: "000000", cashOutId: "co-1" },
          auth: { uid: AGENT },
        })
      ).rejects.toThrow(/Invalid PIN/);

      expect(db.runTransaction).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated callers", async () => {
      await expect(
        fn()({ data: { otpCode: "123456", agentPin: "123456" } })
      ).rejects.toThrow();
    });
  });
});
