import { Wallet } from '../types';

/**
 * What the getBalance callable returns. lastTransactionAt is an ISO string;
 * older servers sent a Date, which a callable delivers as {}.
 */
export type BalanceResponse = Omit<Wallet, 'lastTransactionAt'> & {
  lastTransactionAt?: unknown;
};

/**
 * The wallet after a getBalance refresh. lastTransactionAt goes back to a Date
 * (screens call .getTime() on it; a string there crashed the Dashboard on
 * pull-to-refresh), and fields getBalance leaves out keep their listener values.
 * When the response's time can't be read, the listener's time is kept.
 */
export function walletFromBalance(prev: Wallet | null, res: BalanceResponse): Wallet {
  const { lastTransactionAt, ...rest } = res;
  const at = typeof lastTransactionAt === 'string' ? new Date(lastTransactionAt) : null;
  return {
    ...(prev ?? {}),
    ...rest,
    lastTransactionAt: at && !Number.isNaN(at.getTime()) ? at : prev?.lastTransactionAt ?? null,
  } as Wallet;
}
