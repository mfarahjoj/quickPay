import * as fs from "fs";
import * as path from "path";

/**
 * Every callable enforces App Check (CLAUDE.md, money invariant 5).
 *
 * The rule used to live only in review: 26 callables shipped without it,
 * among them refundPayment (moves money), loginWithPin (mints a session
 * without one) and setupPin (credits the referral bonus). App Check is not
 * what authorises a caller — auth, PINs and roles do that — but without it
 * any script holding a session can hit these directly, at whatever rate it
 * likes.
 *
 * The option can't be read back off a deployed v2 function, so this checks
 * the source: every `onCall(` must open with an options object containing
 * `enforceAppCheck: true`. HTTP endpoints (`onRequest`: webhooks, the
 * merchant API, web top-up) authenticate their own way and are not covered.
 */

const SRC = path.join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

interface Callable {
  where: string;
  options: string;
}

function callables(): Callable[] {
  return sourceFiles(SRC).flatMap((file) => {
    const text = fs.readFileSync(file, "utf8");
    const found: Callable[] = [];
    const re = /onCall\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const after = text.slice(match.index + match[0].length);
      // Options, if any, come before the handler.
      const handler = after.search(/\basync\b/);
      const line = text.slice(0, match.index).split("\n").length;
      found.push({
        where: `${path.relative(SRC, file)}:${line}`,
        options: handler >= 0 ? after.slice(0, handler) : after,
      });
    }
    return found;
  });
}

describe("App Check coverage", () => {
  const all = callables();

  it("finds the callables (the scan itself works)", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("enforces App Check on every callable", () => {
    const missing = all
      .filter((c) => !/enforceAppCheck:\s*true/.test(c.options))
      .map((c) => c.where);
    expect(missing).toEqual([]);
  });
});
