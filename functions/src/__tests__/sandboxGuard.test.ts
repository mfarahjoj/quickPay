import * as fs from "fs";
import * as path from "path";
import {
  initiateZaadPayment,
  checkZaadPaymentStatus,
  initiateZaadPayout,
} from "../integrations/zaad.service";
import {
  initiateEDahabPayment,
  checkEDahabPaymentStatus,
  initiateEDahabPayout,
} from "../integrations/edahab.service";
import {
  createPaymentIntent,
  getPaymentIntent,
  createRefund,
  verifyWebhook,
} from "../integrations/stripe.service";
import { isDeployedFunction } from "../integrations/sandboxGuard";

/**
 * The Zaad, eDahab and Stripe stubs fake success, and their sandbox flags
 * default on whenever the env var is unset — which it is in prod. BACKLOG 3b:
 * no stub may cause a credit there. These fail if the guard is removed.
 */
describe("sandbox stubs", () => {
  const saved = { K_SERVICE: process.env.K_SERVICE, FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const zaadReq = { phoneNumber: "+252630000001", amount: 1_000, reference: "ref-1" };
  const stubCalls: Array<[string, () => Promise<{ success: boolean } | null>]> = [
    ["initiateZaadPayment", () => initiateZaadPayment(zaadReq)],
    ["checkZaadPaymentStatus", () => checkZaadPaymentStatus("ZAAD_1")],
    ["initiateZaadPayout", () => initiateZaadPayout(zaadReq)],
    ["initiateEDahabPayment", () => initiateEDahabPayment(zaadReq)],
    ["checkEDahabPaymentStatus", () => checkEDahabPaymentStatus("EDAHAB_1")],
    ["initiateEDahabPayout", () => initiateEDahabPayout(zaadReq)],
    ["createPaymentIntent", () => createPaymentIntent({ amount: 1_000, currency: "USD", customerId: "c" })],
    ["createRefund", () => createRefund("pi_1")],
  ];

  describe("in a deployed function", () => {
    beforeEach(() => {
      process.env.K_SERVICE = "somefunction";
      delete process.env.FUNCTIONS_EMULATOR;
    });

    it.each(stubCalls)("%s refuses instead of faking success", async (_name, call) => {
      const res = await call();
      expect(res?.success).toBe(false);
    });

    it("getPaymentIntent finds nothing, so nothing reads as succeeded", async () => {
      await expect(getPaymentIntent("pi_forged")).resolves.toBeNull();
    });

    it("verifyWebhook accepts no unsigned body", () => {
      const forged = JSON.stringify({ type: "payment_intent.succeeded" });
      expect(verifyWebhook(forged, "", "")).toBeNull();
    });
  });

  describe("locally", () => {
    it("still fakes success in tests and the emulator", async () => {
      delete process.env.K_SERVICE;
      expect((await initiateZaadPayment(zaadReq)).success).toBe(true);
      process.env.K_SERVICE = "somefunction";
      process.env.FUNCTIONS_EMULATOR = "true";
      expect((await initiateZaadPayment(zaadReq)).success).toBe(true);
    });
  });

  it("tells deployed from local by K_SERVICE and FUNCTIONS_EMULATOR", () => {
    expect(isDeployedFunction({ K_SERVICE: "f" })).toBe(true);
    expect(isDeployedFunction({ K_SERVICE: "f", FUNCTIONS_EMULATOR: "true" })).toBe(false);
    expect(isDeployedFunction({})).toBe(false);
  });
});

/**
 * Second line of defence: no deployed function should reach a stub at all,
 * except the ones listed here with the guard that makes it safe. Re-exporting
 * topupFromMobileMoney or completeRemittance fails this test.
 */
describe("exported functions and the stubs", () => {
  const SRC = path.join(__dirname, "..");
  const STUB_IMPORT = /from\s+["'][./]*integrations\/(zaad|edahab|stripe)\.service["']/;

  /** Exported module → why it may import a stub. */
  const ALLOWED: Record<string, string> = {
    "remittance/stripeWebhook": "answers 503 unless Stripe is really configured (stripeWebhook.test.ts)",
  };

  const exportedModules = (): string[] => {
    const index = fs.readFileSync(path.join(SRC, "index.ts"), "utf8");
    const mods = new Set<string>();
    for (const m of index.matchAll(/^export\s+\{[^}]*\}\s+from\s+["']\.\/([^"']+)["']/gm)) {
      mods.add(m[1]);
    }
    return [...mods];
  };

  it("finds the exports", () => {
    expect(exportedModules().length).toBeGreaterThan(30);
  });

  it("only allow-listed exports import a sandbox stub", () => {
    const offenders = exportedModules().filter((mod) => {
      const file = path.join(SRC, `${mod}.ts`);
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      return STUB_IMPORT.test(text) && !(mod in ALLOWED);
    });
    expect(offenders).toEqual([]);
  });
});
