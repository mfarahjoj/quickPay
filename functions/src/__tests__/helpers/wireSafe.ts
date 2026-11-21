/**
 * A callable's encoder (firebase-functions `encode`) copies an object's own
 * entries. A Date or Timestamp has none worth keeping, so it reaches the app
 * as {} (or as internals). Assert a response holds only strings, numbers,
 * booleans, null, arrays and plain objects, which the encoder carries intact.
 */
export function expectWireSafe(value: unknown, path = "response"): void {
  if (value === null || value === undefined) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}, which a callable can't send`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectWireSafe(v, `${path}[${i}]`));
    return;
  }
  if (kind === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) expectWireSafe(v, `${path}.${k}`);
    return;
  }
  const name = (value as any)?.constructor?.name ?? kind;
  throw new Error(`${path} is a ${name}; a callable sends it as {}. Send a string or number instead.`);
}
