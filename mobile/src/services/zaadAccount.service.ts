import { functions } from './firebase.config';

/**
 * The Zaad account every customer gives: the number they use and the name it
 * is registered to (functions/src/auth/zaadAccount.ts). Changing one already
 * on file takes the PIN.
 */
export async function saveZaadAccount(data: { msisdn: string; name: string; pin?: string }): Promise<void> {
  await functions().httpsCallable('setZaadAccount')(data);
}
