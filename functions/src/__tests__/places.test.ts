import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

/** Google Maps help for the application: key stays server-side, capped per account. */
describe("places", () => {
  let search: any;
  let reverse: any;
  let restore: (() => void) | undefined;
  const fetchMock = jest.fn();

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    (global as any).fetch = fetchMock;
    const mod = await import("../merchants/places");
    search = test.wrap(mod.placesSearch);
    reverse = test.wrap(mod.placesReverseGeocode);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    restore = useFakeFirestore(fakeFirestore({}));
  });
  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

  it("finds shops near the phone and reads the area from the address parts", async () => {
    fetchMock.mockResolvedValue(
      ok({
        places: [
          {
            id: "p1",
            displayName: { text: "Hodan Pharmacy" },
            formattedAddress: "Road 1, Jigjiga Yar, Hargeisa",
            location: { latitude: 9.56, longitude: 44.07 },
            addressComponents: [
              { longText: "Hargeisa", types: ["locality"] },
              { longText: "Jigjiga Yar", types: ["neighborhood"] },
            ],
            primaryTypeDisplayName: { text: "Pharmacy" },
          },
        ],
      })
    );
    const res = await search({ data: { query: "hodan", near: { lat: 9.5, lng: 44.0 } }, auth: { uid: "u1" } });
    expect(res.data).toEqual([
      {
        placeId: "p1",
        name: "Hodan Pharmacy",
        address: "Road 1, Jigjiga Yar, Hargeisa",
        area: "Jigjiga Yar",
        location: { lat: 9.56, lng: 44.07 },
        category: "Pharmacy",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("places:searchText");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body).locationBias.circle.center).toEqual({ latitude: 9.5, longitude: 44.0 });
  });

  it("turns a pin into an address, dropping plus codes", async () => {
    fetchMock.mockResolvedValue(
      ok({
        status: "OK",
        results: [
          { formatted_address: "H2GC+QX Hargeisa", address_components: [{ long_name: "Hargeisa", types: ["locality"] }] },
        ],
      })
    );
    const res = await reverse({ data: { lat: 9.56, lng: 44.07 }, auth: { uid: "u1" } });
    expect(res.data).toEqual({ address: "", area: "Hargeisa" });
  });

  it("caps lookups per account per day", async () => {
    const { DAILY_LOOKUPS } = await import("../merchants/places");
    restore?.();
    restore = useFakeFirestore(
      fakeFirestore({ "places_usage/u1": { day: new Date().toISOString().slice(0, 10), count: DAILY_LOOKUPS } })
    );
    await expect(search({ data: { query: "hodan" }, auth: { uid: "u1" } })).rejects.toThrow(/used up for today/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in caller and a real query", async () => {
    await expect(search({ data: { query: "hodan" } })).rejects.toThrow();
    await expect(search({ data: { query: "h" }, auth: { uid: "u1" } })).rejects.toThrow(/at least 2 letters/);
  });

  it("reports Google failures without leaking them", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}), text: async () => "API key not valid" });
    await expect(search({ data: { query: "hodan" }, auth: { uid: "u1" } })).rejects.toThrow(/isn't working right now/);
  });
});
