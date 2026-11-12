import { Provider, ReceivedPayment, normaliseSomaliMsisdn } from "./core";

/**
 * Reading the operators' "you received money" SMS.
 *
 * Deliberately empty until real samples from the collection SIM are in
 * (ZAPP_TOPUP_AND_RIDY_COMMISSION_PLAN.md §6): a parser written from a guess
 * would credit wrong amounts. Until then every SMS is kept as `unparsed` for
 * an admin, and no money moves on it.
 *
 * Each parser takes the SMS text and returns the payment, or null when the
 * text isn't a "received" message it recognises — never a partial guess.
 */
type Parser = (body: string, receivedAtMs: number) => ReceivedPayment | null;

const PARSERS: Record<Provider, Parser[]> = {
  zaad: [],
  edahab: [],
};

export function parseOperatorSms(
  provider: Provider,
  body: string,
  receivedAtMs: number
): ReceivedPayment | null {
  for (const parse of PARSERS[provider]) {
    const payment = parse(body, receivedAtMs);
    if (payment) return validParse(payment) ? payment : null;
  }
  return null;
}

/** A parse is only used when every field is sane. */
export function validParse(p: ReceivedPayment): boolean {
  return (
    Number.isInteger(p.amountCents) &&
    p.amountCents > 0 &&
    (p.currency === "USD" || p.currency === "SLSH") &&
    normaliseSomaliMsisdn(p.senderMsisdn) === p.senderMsisdn &&
    /^[A-Za-z0-9_-]{4,64}$/.test(p.operatorTxnId)
  );
}
