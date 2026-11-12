import { functions } from './firebase.config';

/**
 * Zaad / eDahab top-ups through Zapp's collection number
 * (functions/src/mobileMoney/). The customer links their number once by
 * sending a small activation payment from it; after that, money they send
 * from it to the collection number lands in their wallet.
 */

export type MobileMoneyProvider = 'zaad' | 'edahab';

export interface LinkResult {
  provider: MobileMoneyProvider;
  msisdn: string;
  status: 'pending' | 'verified';
  collectionNumber: string;
  activationCents: number;
  dialCode: string | null;
  topupMinCents: number;
  topupMaxCents: number;
}

export interface TopupInstructions {
  provider: MobileMoneyProvider;
  fromMsisdn: string;
  collectionNumber: string;
  amountCents: number;
  dialCode: string | null;
}

export async function startNumberLink(provider: MobileMoneyProvider, msisdn: string): Promise<LinkResult> {
  const result = await functions().httpsCallable('startNumberLink')({ provider, msisdn });
  return (result.data as { data: LinkResult }).data;
}

export async function getTopupInstructions(
  provider: MobileMoneyProvider,
  amountCents: number
): Promise<TopupInstructions> {
  const result = await functions().httpsCallable('getTopupInstructions')({ provider, amountCents });
  return (result.data as { data: TopupInstructions }).data;
}

export { ussdUrl, canDialUssd, formatLocal, amountCents, dollars } from './mobileMoney.utils';
