import {
  PUSH_LANGUAGES,
  PUSH_TEMPLATES,
  PushMessage,
  PushTemplateKey,
  PAYOUT_ROUTE_NAMES,
  ROLE_NAMES,
  UNNAMED_PHONE,
  formatDays,
  renderPush,
  resolveLanguage,
} from "../utils/pushTemplates";

const ARABIC = /[؀-ۿ]/;
const placeholders = (text: { title: string; body: string }) =>
  [...`${text.title}\n${text.body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** WALLET_READINESS_PLAN.md F14: pushes in the user's own language. */
describe("push templates", () => {
  const keys = Object.keys(PUSH_TEMPLATES) as PushTemplateKey[];

  it.each(keys)("%s has every language, each with English's placeholders", (key) => {
    const template = PUSH_TEMPLATES[key];
    for (const language of PUSH_LANGUAGES) {
      const text = template[language];
      expect(text.title.trim()).not.toBe("");
      expect(text.body.trim()).not.toBe("");
      expect(placeholders(text)).toEqual(placeholders(template.en));
      // A brace that isn't part of a whole {placeholder} would reach the phone as is.
      expect(`${text.title}${text.body}`.replace(/\{\w+\}/g, "")).not.toMatch(/[{}]/);
    }
  });

  it.each(keys)("%s is translated, not English copied over", (key) => {
    const { en, so, ar } = PUSH_TEMPLATES[key];
    expect(so.title).not.toBe(en.title);
    expect(so.body).not.toBe(en.body);
    expect(ar.title).toMatch(ARABIC);
    expect(ar.body).toMatch(ARABIC);
  });

  it("has every role, route and unnamed phone in every language", () => {
    for (const term of [
      ...Object.values(ROLE_NAMES),
      ...Object.values(PAYOUT_ROUTE_NAMES),
      ...Object.values(UNNAMED_PHONE),
    ]) {
      for (const language of PUSH_LANGUAGES) expect(term[language].trim()).not.toBe("");
      expect(term.ar).toMatch(ARABIC);
    }
  });
});

describe("resolveLanguage", () => {
  it.each([
    ["en", "en"],
    ["so", "so"],
    ["ar", "ar"],
    ["SO", "so"],
    [" ar ", "ar"],
    ["so-SO", "so"],
    ["ar_SA", "ar"],
  ])("reads %p as %p", (stored, language) => {
    expect(resolveLanguage(stored)).toBe(language);
  });

  it.each([[undefined], [null], [""], ["fr"], ["somali"], [42], [{}], [["so"]]])(
    "falls back to English for %p",
    (stored) => {
      expect(resolveLanguage(stored)).toBe("en");
    }
  );
});

describe("renderPush", () => {
  const received: PushMessage = { key: "payment.received", params: { amount: "USD 12.50" } };

  it("writes the message in the language asked for", () => {
    expect(renderPush(received, "en")).toEqual({ title: "Payment Received", body: "You received USD 12.50" });
    expect(renderPush(received, "so")).toEqual({ title: "Lacag ayaad heshay", body: "Waxaad heshay USD 12.50." });
    expect(renderPush(received, "ar")).toEqual({ title: "تم استلام الدفع", body: "وصلتك دفعة بقيمة USD 12.50." });
  });

  it("puts values in as given, even ones that look like placeholders", () => {
    const rejected: PushMessage = { key: "kyc.rejected", params: { reason: "Blurred photo {amount} $& $1" } };
    expect(renderPush(rejected, "en").body).toBe("We could not verify your documents. Blurred photo {amount} $& $1");
  });

  it("uses a value's own translation when it has one", () => {
    const approved: PushMessage = { key: "role.approved", params: { role: ROLE_NAMES.topup_agent } };
    expect(renderPush(approved, "en").body).toBe("You can now use Zapp Pay as a top-up agent.");
    expect(renderPush(approved, "so").body).toBe("Hadda Zapp Pay waxaad u isticmaali kartaa wakiil ku-shubis ahaan.");
    expect(renderPush(approved, "ar").body).toBe("أصبح حسابك في Zapp Pay حساب وكيل شحن.");
  });

  it("writes a moment in Hargeisa time, in each language", () => {
    // 22:30 UTC on Wednesday 28 October is 01:30 on Thursday the 29th in Hargeisa (UTC+3).
    const reset: PushMessage = { key: "security.pin_reset", params: { until: new Date("2026-10-28T22:30:00Z") } };
    expect(renderPush(reset, "en").body).toBe(
      "If this wasn't you, contact support now. Sending money is paused until Thu 29 Oct, 01:30 (Hargeisa time)."
    );
    expect(renderPush(reset, "so").body).toBe(
      "Haddii aadan adigu samayn, hadda la xiriir taageerada. " +
        "Dirista lacagta waa la hakiyay ilaa Khamiis 29 Oktoobar, 01:30 (waqtiga Hargeysa)."
    );
    expect(renderPush(reset, "ar").body).toBe(
      "إذا لم تقم بذلك، تواصل مع الدعم الآن. إرسال الأموال متوقف حتى الخميس 29 أكتوبر، الساعة 01:30 بتوقيت هرجيسا."
    );
  });

  it.each([
    [1, "1 day", "1 maalin", "يوم واحد"],
    [2, "2 days", "2 maalmood", "يومين"],
    [3, "3 days", "3 maalmood", "3 أيام"],
    [10, "10 days", "10 maalmood", "10 أيام"],
    [11, "11 days", "11 maalmood", "11 يومًا"],
    [100, "100 days", "100 maalmood", "100 يوم"],
  ])("counts %i days in each language's plural", (days, en, so, ar) => {
    expect(formatDays(days, "en")).toBe(en);
    expect(formatDays(days, "so")).toBe(so);
    expect(formatDays(days, "ar")).toBe(ar);
  });

  it("writes a dispute's reply window in the merchant's language", () => {
    const opened: PushMessage = {
      key: "dispute.refund_requested",
      params: { amount: "$10.00", days: { days: 3 } },
    };
    expect(renderPush(opened, "en").body).toBe("A customer asked for a refund of $10.00. Reply within 3 days.");
    expect(renderPush(opened, "so").body).toBe(
      "Macmiil ayaa codsaday in loo celiyo $10.00. Ka jawaab 3 maalmood gudahood."
    );
    expect(renderPush(opened, "ar").body).toBe("طلب عميل استرداد $10.00. يرجى الرد خلال 3 أيام.");
  });

  it("sends English when a translation can't be filled", () => {
    const template = PUSH_TEMPLATES["kyc.approved"] as unknown as Record<string, { title: string; body: string }>;
    const somali = template.so;
    template.so = { title: "{missing}", body: somali.body };
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(renderPush({ key: "kyc.approved" }, "so")).toEqual(PUSH_TEMPLATES["kyc.approved"].en);
      expect(logged).toHaveBeenCalled();
    } finally {
      template.so = somali;
      logged.mockRestore();
    }
  });

  it("refuses a message missing a value rather than send a raw placeholder", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => renderPush({ key: "payment.received" } as unknown as PushMessage, "so")).toThrow("{amount}");
    } finally {
      logged.mockRestore();
    }
  });
});
