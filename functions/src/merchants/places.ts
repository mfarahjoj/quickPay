/**
 * Google Maps help for the merchant / agent application: find the shop on
 * Google, or turn a dragged map pin into an address.
 *
 * The Google key never ships in the app: it lives in Secret Manager and only
 * these two callables use it, each capped per account per day, so a leaked
 * session can't run up the Maps bill.
 *
 * Set the key once per project before deploying (a key restricted to the
 * Places API (New) and the Geocoding API):
 *   firebase functions:secrets:set GOOGLE_MAPS_API_KEY
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { requireAuth } from "../utils/validation";
import { PIN_PEPPER } from "../config/secrets";
import { ApiResponse, GeoPin } from "../types";

export const GOOGLE_MAPS_API_KEY = defineSecret("GOOGLE_MAPS_API_KEY");

/** Lookups per account per day, search and pin together. */
export const DAILY_LOOKUPS = 60;
const USAGE = "places_usage";

/** Hargeisa: where results lean when the phone gives no position. */
const DEFAULT_CENTER = { latitude: 9.5624, longitude: 44.077 };

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  area: string;
  location: GeoPin | null;
  /** Google's category, e.g. "Pharmacy", for the business type. */
  category: string | null;
}

type Component = { longText?: string; long_name?: string; types?: string[] };

/** The neighbourhood a customer would name, from Google's address parts. */
export function areaFrom(components: Component[] | undefined): string {
  if (!components?.length) return "";
  const name = (c: Component) => c.longText ?? c.long_name ?? "";
  for (const type of ["neighborhood", "sublocality_level_1", "sublocality", "locality", "administrative_area_level_2"]) {
    const hit = components.find((c) => c.types?.includes(type) && name(c));
    if (hit) return name(hit);
  }
  return "";
}

/** One call per account per lookup; refuses past the daily cap. */
async function spendLookup(uid: string): Promise<void> {
  const db = admin.firestore();
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection(USAGE).doc(uid);
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as { day?: string; count?: number } | undefined;
    const count = cur?.day === day ? cur.count ?? 0 : 0;
    if (count >= DAILY_LOOKUPS) {
      throw new https.HttpsError("resource-exhausted", "Map search is used up for today. Fill the details in yourself.");
    }
    tx.set(ref, { day, count: count + 1, updatedAt: admin.firestore.Timestamp.now() });
  });
}

function pinFrom(value: unknown): { latitude: number; longitude: number } | null {
  const v = value as { lat?: unknown; lng?: unknown } | null | undefined;
  if (typeof v?.lat !== "number" || typeof v?.lng !== "number") return null;
  if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
  return { latitude: v.lat, longitude: v.lng };
}

function googleFailed(status: number, detail: string): never {
  console.error(`Google Maps call failed (${status}): ${detail.slice(0, 300)}`);
  throw new https.HttpsError("unavailable", "Map search isn't working right now. Fill the details in yourself.");
}

/** Callable: find shops on Google by name, near the phone (or Hargeisa). */
export const placesSearch = https.onCall(
  { enforceAppCheck: true, secrets: [PIN_PEPPER, GOOGLE_MAPS_API_KEY] },
  async (request: https.CallableRequest<{ query: string; near?: GeoPin }>): Promise<ApiResponse<PlaceResult[]>> => {
    requireAuth(request);
    const query = typeof request.data?.query === "string" ? request.data.query.trim() : "";
    if (query.length < 2 || query.length > 80) {
      throw new https.HttpsError("invalid-argument", "Type at least 2 letters of the shop's name");
    }
    await spendLookup(request.auth!.uid);

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY.value(),
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.primaryTypeDisplayName",
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 6,
        locationBias: { circle: { center: pinFrom(request.data?.near) ?? DEFAULT_CENTER, radius: 30000 } },
      }),
    });
    if (!res.ok) googleFailed(res.status, await res.text());
    const body = (await res.json()) as {
      places?: Array<{
        id: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
        addressComponents?: Component[];
        primaryTypeDisplayName?: { text?: string };
      }>;
    };

    const results: PlaceResult[] = (body.places ?? []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      area: areaFrom(p.addressComponents),
      location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
      category: p.primaryTypeDisplayName?.text ?? null,
    }));
    return { success: true, data: results };
  }
);

/** Callable: the address and area at a map pin. */
export const placesReverseGeocode = https.onCall(
  { enforceAppCheck: true, secrets: [PIN_PEPPER, GOOGLE_MAPS_API_KEY] },
  async (request: https.CallableRequest<GeoPin>): Promise<ApiResponse<{ address: string; area: string }>> => {
    requireAuth(request);
    const pin = pinFrom(request.data);
    if (!pin) throw new https.HttpsError("invalid-argument", "A map position is required");
    await spendLookup(request.auth!.uid);

    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?latlng=${pin.latitude},${pin.longitude}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY.value())}`;
    const res = await fetch(url);
    if (!res.ok) googleFailed(res.status, await res.text());
    const body = (await res.json()) as {
      status: string;
      error_message?: string;
      results?: Array<{ formatted_address?: string; address_components?: Component[] }>;
    };
    if (body.status !== "OK" && body.status !== "ZERO_RESULTS") googleFailed(200, `${body.status} ${body.error_message ?? ""}`);

    const first = body.results?.[0];
    // An unnamed road or a plus code isn't an address anyone would recognise;
    // the area alone is still useful.
    const address = first?.formatted_address && !/^[A-Z0-9]{4}\+[A-Z0-9]{2,}/.test(first.formatted_address) ? first.formatted_address : "";
    const area = body.results?.map((r) => areaFrom(r.address_components)).find(Boolean) ?? "";
    return { success: true, data: { address, area } };
  }
);
