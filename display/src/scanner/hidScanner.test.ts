import { describe, expect, it } from "vitest";
import { createHidAssembler, KEY_GAP_MS, REPEAT_MS } from "./hidScanner";

const TOKEN =
  "v2:7ca1e954eaad9a0317c8c903:85ea6b8b93746868eae87ab2c97df6e3:a9eb7b1e437df1a99374dcc695cb865961571f274e6ed1d305a2734d35d728bf";

/** Types `text` then Enter, `gapMs` apart, starting at `t0`. Returns the token emitted (if any) and the end time. */
function type(a: ReturnType<typeof createHidAssembler>, text: string, t0: number, gapMs = 5, end = "Enter") {
  let t = t0;
  let out: string | null = null;
  for (const ch of text) {
    out = a.feed(ch, t) ?? out;
    t += gapMs;
  }
  out = a.feed(end, t) ?? out;
  return { out, t };
}

describe("hidScanner", () => {
  it("assembles a fast burst ending in Enter", () => {
    const a = createHidAssembler();
    expect(type(a, TOKEN, 1000).out).toBe(TOKEN);
  });

  it("accepts Tab as the terminator", () => {
    const a = createHidAssembler();
    expect(type(a, TOKEN, 1000, 5, "Tab").out).toBe(TOKEN);
  });

  it("recovers a layout-mangled colon and Caps Lock", () => {
    const a = createHidAssembler();
    expect(type(a, TOKEN.replace(/:/g, ";").toUpperCase(), 1000).out).toBe(TOKEN);
  });

  it("rejects slow typing", () => {
    const a = createHidAssembler();
    expect(type(a, TOKEN, 1000, KEY_GAP_MS + 1).out).toBeNull();
  });

  it("a pause clears what came before", () => {
    const a = createHidAssembler();
    a.feed("x", 0);
    a.feed("y", 5);
    expect(type(a, TOKEN, 5 + KEY_GAP_MS + 50).out).toBe(TOKEN);
  });

  it("ignores modifier and unidentified keys", () => {
    const a = createHidAssembler();
    let t = 0;
    for (const ch of TOKEN) {
      a.feed("Shift", t);
      a.feed(ch, t + 1);
      t += 4;
    }
    expect(a.feed("Enter", t)).toBe(TOKEN);
  });

  it("suppresses a repeat within 3 s, then accepts it again", () => {
    const a = createHidAssembler();
    const first = type(a, TOKEN, 0);
    expect(first.out).toBe(TOKEN);
    const second = type(a, TOKEN, first.t + 500);
    expect(second.out).toBeNull();
    expect(type(a, TOKEN, first.t + REPEAT_MS + 10).out).toBe(TOKEN);
  });

  it("ignores short or non-Zapp buffers", () => {
    const a = createHidAssembler();
    expect(type(a, "12345", 0).out).toBeNull();
    expect(type(a, "https://example.com/" + "a".repeat(80), 1000).out).toBeNull();
  });

  it("submit applies the same rules (compat input, camera)", () => {
    const a = createHidAssembler();
    expect(a.submit(TOKEN + "\r\n", 0)).toBe(TOKEN);
    expect(a.submit(TOKEN, 100)).toBeNull();
    expect(a.submit("hello", 5000)).toBeNull();
  });
});
