import { functions } from './firebase.config';

/**
 * The Zaad account every merchant and agent gives: the number they use and
 * the name it's registered to (functions/src/auth/zaadAccount.ts). Payouts go
 * only there. Changing one already on file takes the PIN.
 */
export async function saveZaadAccount(data: { msisdn: string; name: string; pin?: string }): Promise<void> {
  await functions().httpsCallable('setZaadAccount')(data);
}
