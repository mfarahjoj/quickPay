import { Wallet } from '../types';

/** What the getBalance callable returns: a Date arrives as an ISO string. */
export type BalanceResponse = Omit<Wallet, 'lastTransactionAt'> & {
  lastTransactionAt?: string | null;
};

/**
 * The wallet after a getBalance refresh. lastTransactionAt goes back to a Date
 * (screens call .getTime() on it; a string there crashed the Dashboard on
 * pull-to-refresh), and fields getBalance leaves out keep their listener values.
 */
export function walletFromBalance(prev: Wallet | null, res: BalanceResponse): Wallet {
  const { lastTransactionAt, ...rest } = res;
  const at = lastTransactionAt ? new Date(lastTransactionAt) : null;
  return {
    ...(prev ?? {}),
    ...rest,
    lastTransactionAt: at && !Number.isNaN(at.getTime()) ? at : null,
  } as Wallet;
}
