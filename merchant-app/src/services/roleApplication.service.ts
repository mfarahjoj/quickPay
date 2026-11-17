import Geolocation from '@react-native-community/geolocation';
import { auth, functions, storage } from './firebase.config';
import { logger } from '../utils/logger';

export type ApplicantRole = 'merchant' | 'topup_agent' | 'agent_merchant';
export type IdType = 'national_id' | 'passport' | 'drivers_license';
export type PhotoKind = 'shop' | 'front' | 'back' | 'selfie';
export type AgentService = 'cash_in' | 'cash_out';

export interface GeoPin {
  lat: number;
  lng: number;
  accuracyM?: number;
}

export interface RoleApplicationInput {
  requestedRole: ApplicantRole;
  businessName: string;
  businessType: string;
  businessAddress: string;
  area: string;
  location: GeoPin | null;
  shopPhotoPath: string;
  payout?: { provider: 'zaad' | 'edahab'; number: string };
  agent?: { openHours?: string; services?: AgentService[]; zaadReceiveNumber?: string };
  zaadName?: string;
  id?: { idType: IdType; idNumber?: string; frontPath: string; backPath?: string; selfiePath: string };
}

/** What a previous (rejected) application held, to prefill the form. */
export interface PreviousApplication {
  businessName?: string;
  businessType?: string;
  businessAddress?: string;
  area?: string;
  location?: GeoPin | null;
  payout?: { provider: 'zaad' | 'edahab'; number: string };
  agent?: { openHours?: string; services?: AgentService[]; zaadReceiveNumber?: string };
}

export function isMerchantRole(role: ApplicantRole): boolean {
  return role === 'merchant' || role === 'agent_merchant';
}

export function isAgentRole(role: ApplicantRole): boolean {
  return role === 'topup_agent' || role === 'agent_merchant';
}

/**
 * Upload one photo into the applicant's own KYC folder (the only place the
 * Storage rules let them write ID images). Returns the object path, which is
 * what the server stores: the console signs short-lived links from it.
 */
export async function uploadApplicationPhoto(kind: PhotoKind, filePath: string): Promise<string> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  const path = `kyc/${uid}/${kind}_${Date.now()}.jpg`;
  const local = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
  await storage().ref(path).putFile(local, { contentType: 'image/jpeg' });
  return path;
}

export async function submitRoleApplication(input: RoleApplicationInput): Promise<void> {
  const res = await functions().httpsCallable('submitRoleApplication')(input);
  const body = res.data as { success: boolean; error?: string };
  if (!body?.success) throw new Error(body?.error || 'Could not send your application');
}

/** The rejected application for this role, if any, so the form starts filled in. */
export async function getPreviousApplication(role: ApplicantRole): Promise<PreviousApplication | null> {
  try {
    const res = await functions().httpsCallable('getMyRoleRequests')();
    const rows = ((res.data as { data?: unknown[] })?.data ?? []) as Array<{
      requestedRole?: string;
      previousApplication?: PreviousApplication;
      application?: PreviousApplication;
    }>;
    const row = rows.find((r) => r.requestedRole === role);
    return row?.application ?? row?.previousApplication ?? null;
  } catch (err) {
    logger.warn('getPreviousApplication failed:', err);
    return null;
  }
}

/** The phone's current position, for the shop pin. */
export function currentPosition(): Promise<GeoPin> {
  return new Promise((resolve, reject) => {
    Geolocation.requestAuthorization(
      () =>
        Geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy ?? undefined,
            }),
          (err) => reject(new Error(err.message)),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
        ),
      (err) => reject(new Error(err.message))
    );
  });
}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  area: string;
  location: GeoPin | null;
  category: string | null;
}

/** Shops on Google matching a name, near `near` (through Zapp's server). */
export async function searchPlaces(query: string, near: GeoPin | null): Promise<PlaceResult[]> {
  const res = await functions().httpsCallable('placesSearch')({ query, ...(near ? { near } : {}) });
  return ((res.data as { data?: PlaceResult[] })?.data ?? []) as PlaceResult[];
}

/** The address and area at a map pin. Empty strings when Google has none. */
export async function addressAt(pin: GeoPin): Promise<{ address: string; area: string }> {
  const res = await functions().httpsCallable('placesReverseGeocode')({ lat: pin.lat, lng: pin.lng });
  return ((res.data as { data?: { address: string; area: string } })?.data ?? { address: '', area: '' });
}
