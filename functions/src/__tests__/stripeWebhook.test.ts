import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

/**
 * stripeWebhook is a public, unauthenticated endpoint that credits a wallet
 * against float:bank. In sandbox, verifyWebhook returns the request body with
 * no signature check, so without an explicit guard anyone who can reach the
 * URL could mint balance. These tests pin that guard.
 */
describe("stripeWebhook sandbox guard", () => {
  let stripeWebhook: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../remittance/stripeWebhook");
    stripeWebhook = mod.stripeWebhook;
  });

  afterAll(() => {
    test.cleanup();
  });

  function mockRes() {
    const res: any = {
      statusCode: 0,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(payload: any) {
        this.body = payload;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  it("refuses to credit while Stripe is in sandbox", async () => {
    // STRIPE_SANDBOX defaults to true whenever the env var is unset, which is
    // the state of the deployed project.
    const req: any = {
      method: "POST",
      headers: {},
      rawBody: JSON.stringify({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_sandbox_forged" } },
      }),
      body: {},
    };
    const res = mockRes();

    await stripeWebhook(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatch(/not configured/i);
  });

  it("still rejects non-POST before anything else", async () => {
    const req: any = { method: "GET", headers: {}, body: {} };
    const res = mockRes();

    await stripeWebhook(req, res);

    expect(res.statusCode).toBe(405);
  });
});
