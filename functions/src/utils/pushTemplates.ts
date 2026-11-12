/**
 * Push notification texts, in every language the apps ship: en, so, ar.
 *
 * The apps carry their own strings, but pushes are written here on the server,
 * so their texts live here too. `notifyUser` and `sendPushNotification` render
 * a template in the recipient's `users/{uid}.preferredLanguage` — the same
 * field the apps switch their own language from — and use English when it is
 * unset or not one of these three, as the apps do.
 *
 * Placeholders are `{name}`. Every language uses exactly the placeholders its
 * English text does (pushTemplates.test.ts checks), so a call site that fills
 * the English one fills them all. Amounts arrive already formatted ("$5.00",
 * "USD 5.00") with Latin digits, as both apps show them in every language.
 *
 * Wording follows the apps' own locale files where they have a term: wallet
 * "jeeb"/"محفظة", top-up "ku darid"/"شحن", cash-out "lacag-qaadasho"/"سحب",
 * dispute "cabasho"/"نزاع", payout "lacag-bixin"/"تحويل", float
 * "float"/"رصيد تشغيلي", support "taageerada"/"الدعم".
 */

import { FloatRouteName, PreferredLanguage, PrivilegedRole } from "../types";

export const PUSH_LANGUAGES: readonly PreferredLanguage[] = ["en", "so", "ar"];

export interface PushText {
  title: string;
  body: string;
}

type Translations = Record<PreferredLanguage, PushText>;

/** Text in each language, for a value that itself needs translating: a role, a route. */
export type Localized = Readonly<Record<PreferredLanguage, string>>;

export type PushParam =
  /** Shown as is: amounts, names, phone numbers, an admin's reason. */
  | string
  /** A moment, written out in Hargeisa time. */
  | Date
  /** A number of days, with each language's plural ("1 day", "يومين"). */
  | { days: number }
  | Localized;

export const PUSH_TEMPLATES = {
  // Payments
  "payment.received": {
    en: { title: "Payment Received", body: "You received {amount}" },
    so: { title: "Lacag ayaad heshay", body: "Waxaad heshay {amount}." },
    ar: { title: "تم استلام الدفع", body: "وصلتك دفعة بقيمة {amount}." },
  },
  "payment.sent": {
    en: { title: "Payment Sent", body: "You paid {amount}" },
    so: { title: "Lacag-bixinta waa la diray", body: "Waxaad bixisay {amount}." },
    ar: { title: "تم إرسال الدفع", body: "تم دفع {amount} من محفظتك." },
  },
  "payment.request": {
    en: { title: "Payment Request", body: "{merchant} is requesting {amount}" },
    so: { title: "Codsiga lacag bixinta", body: "{merchant} ayaa kaa codsanaya {amount}." },
    ar: { title: "طلب دفع", body: "يطلب منك {merchant} دفع {amount}." },
  },
  "payment.request_with_reference": {
    en: { title: "Payment Request", body: "{merchant} is requesting {amount} — {reference}" },
    so: { title: "Codsiga lacag bixinta", body: "{merchant} ayaa kaa codsanaya {amount} — {reference}" },
    ar: { title: "طلب دفع", body: "يطلب منك {merchant} دفع {amount} — {reference}" },
  },
  "payment.declined": {
    en: { title: "Payment Declined", body: "{customer} declined your payment request" },
    so: { title: "Lacag bixintu waa la diiday", body: "Codsigaaga lacag bixinta waxaa diiday {customer}." },
    ar: { title: "تم رفض الدفع", body: "رفض {customer} طلب الدفع الخاص بك." },
  },
  "refund.received": {
    en: { title: "Refund Received", body: "You were refunded {amount}" },
    so: { title: "Lacag ayaa laguu celiyay", body: "Waxaa laguu celiyay {amount}." },
    ar: { title: "تم الاسترداد", body: "أُعيد مبلغ {amount} إلى محفظتك." },
  },

  // Top-ups and referral bonuses
  "topup.completed": {
    en: { title: "Top-up Successful", body: "Your wallet has been credited with {amount}" },
    so: { title: "Ku dariddu waa guulaysatay", body: "Jeebkaaga waxaa lagu shubay {amount}." },
    ar: { title: "تم الشحن بنجاح", body: "تمت إضافة {amount} إلى محفظتك." },
  },
  "topup.by_agent": {
    en: { title: "Top-up Successful", body: "{agent} topped up your wallet with {amount}" },
    so: { title: "Ku dariddu waa guulaysatay", body: "{agent} ayaa jeebkaaga ku shubay {amount}." },
    ar: { title: "تم الشحن بنجاح", body: "قام {agent} بشحن محفظتك بمبلغ {amount}." },
  },
  "referral.welcome_bonus": {
    en: { title: "Referral bonus", body: "You got a {amount} welcome bonus." },
    so: { title: "Abaalmarin casuumaad", body: "Waxaad heshay {amount} oo abaalmarin soo dhaweyn ah." },
    ar: { title: "مكافأة دعوة", body: "تمت إضافة مكافأة ترحيب بقيمة {amount} إلى محفظتك." },
  },
  "referral.friend_joined": {
    en: { title: "Referral bonus", body: "Your friend joined: you got {amount}." },
    so: { title: "Abaalmarin casuumaad", body: "Saaxiibkaa wuu ku soo biiray, waxaadna heshay {amount}." },
    ar: { title: "مكافأة دعوة", body: "انضم صديقك، وتمت إضافة {amount} إلى محفظتك." },
  },

  // Cash-out
  "cashout.request": {
    en: { title: "Cash-out", body: "{merchant} will give you {amount} in cash. Approve to cash out." },
    so: {
      title: "Lacag-qaadasho",
      body: "{merchant} ayaa ku siinaya {amount} lacag caddaan ah. Ogolow si aad lacagta ula baxdo.",
    },
    ar: { title: "سحب نقدي", body: "سيسلّمك {merchant} مبلغ {amount} نقدًا. وافق لإتمام السحب." },
  },
  "cashout.hand_over": {
    en: { title: "Cash-out approved", body: "Hand over {amount} in cash now." },
    so: { title: "Lacag-qaadashada waa la ogolaaday", body: "Hadda macmiilka u dhiib {amount} lacag caddaan ah." },
    ar: { title: "تمت الموافقة على السحب", body: "سلّم العميل {amount} نقدًا الآن." },
  },
  "cashout.completed": {
    en: { title: "Cash Out Complete", body: "You cashed out {amount}. Collect your cash from the agent." },
    so: { title: "Lacag-qaadashadu way dhammaatay", body: "Waxaad la baxday {amount}. Lacagtaada ka qaado wakiilka." },
    ar: { title: "اكتمل السحب", body: "سحبت {amount}. استلم نقودك من الوكيل." },
  },
  "cashout.paid_by_agent": {
    en: { title: "Cash Out Complete", body: "{agent} paid out your cash-out of {amount}" },
    so: { title: "Lacag-qaadashadu way dhammaatay", body: "{agent} ayaa kuu bixiyay lacag-qaadashadaada oo dhan {amount}." },
    ar: { title: "اكتمل السحب", body: "سلّمك {agent} مبلغ السحب البالغ {amount}." },
  },
  "cashout.returned.cancelled": {
    en: { title: "Cash-out money returned", body: "{amount} is back in your wallet. Cash-out cancelled." },
    so: {
      title: "Lacagtii waa laguu soo celiyay",
      body: "Lacag-qaadashada waa la joojiyay. {amount} waxay ku soo noqotay jeebkaaga.",
    },
    ar: { title: "تمت إعادة مبلغ السحب", body: "تم إلغاء السحب، وأُعيد مبلغ {amount} إلى محفظتك." },
  },
  "cashout.returned.replaced": {
    en: {
      title: "Cash-out money returned",
      body: "{amount} is back in your wallet. Cash-out replaced by a new request.",
    },
    so: {
      title: "Lacagtii waa laguu soo celiyay",
      body: "Lacag-qaadashada waxaa beddelay codsi cusub. {amount} waxay ku soo noqotay jeebkaaga.",
    },
    ar: { title: "تمت إعادة مبلغ السحب", body: "استُبدل طلب السحب بطلب جديد، وأُعيد مبلغ {amount} إلى محفظتك." },
  },
  "cashout.returned.expired": {
    en: { title: "Cash-out money returned", body: "{amount} is back in your wallet. Cash-out expired." },
    so: {
      title: "Lacagtii waa laguu soo celiyay",
      body: "Lacag-qaadashada waqtigeedii wuu dhacay. {amount} waxay ku soo noqotay jeebkaaga.",
    },
    ar: { title: "تمت إعادة مبلغ السحب", body: "انتهت صلاحية طلب السحب، وأُعيد مبلغ {amount} إلى محفظتك." },
  },
  "cashout.returned.too_many_attempts": {
    en: {
      title: "Cash-out money returned",
      body: "{amount} is back in your wallet. Cash-out locked after wrong codes.",
    },
    so: {
      title: "Lacagtii waa laguu soo celiyay",
      body: "Lacag-qaadashada waa la xiray kadib markii koodh khaldan la geliyay dhowr jeer. {amount} waxay ku soo noqotay jeebkaaga.",
    },
    ar: {
      title: "تمت إعادة مبلغ السحب",
      body: "أُقفل طلب السحب بعد إدخال رموز خاطئة، وأُعيد مبلغ {amount} إلى محفظتك.",
    },
  },

  // Security
  "security.pin_changed": {
    en: {
      title: "Your Zapp Pay PIN was changed",
      body: "If this wasn't you, reset your PIN now and contact support.",
    },
    so: {
      title: "PIN-kaaga Zapp Pay waa la beddelay",
      body: "Haddii aadan adigu samayn, hadda dib u deji PIN-kaaga oo la xiriir taageerada.",
    },
    ar: {
      title: "تم تغيير رمز PIN في Zapp Pay",
      body: "إذا لم تقم بذلك، أعد تعيين رمز PIN الآن وتواصل مع الدعم.",
    },
  },
  "security.pin_reset": {
    en: {
      title: "Your Zapp Pay PIN was reset",
      body: "If this wasn't you, contact support now. Sending money is paused until {until}.",
    },
    so: {
      title: "PIN-kaaga Zapp Pay dib ayaa loo dejiyay",
      body: "Haddii aadan adigu samayn, hadda la xiriir taageerada. Dirista lacagta waa la hakiyay ilaa {until}.",
    },
    ar: {
      title: "تمت إعادة تعيين رمز PIN في Zapp Pay",
      body: "إذا لم تقم بذلك، تواصل مع الدعم الآن. إرسال الأموال متوقف حتى {until}.",
    },
  },
  "security.phone_changed": {
    en: {
      title: "Your Zapp Pay number was changed",
      body: "Your account now uses {phone}. Sending money is paused until {until}. If this wasn't you, contact support now.",
    },
    so: {
      title: "Lambarkaaga Zapp Pay waa la beddelay",
      body: "Akoonkaagu hadda wuxuu isticmaalaa {phone}. Dirista lacagta waa la hakiyay ilaa {until}. Haddii aadan adigu samayn, hadda la xiriir taageerada.",
    },
    ar: {
      title: "تم تغيير رقمك في Zapp Pay",
      body: "يستخدم حسابك الآن {phone}. إرسال الأموال متوقف حتى {until}. إذا لم تقم بذلك، تواصل مع الدعم الآن.",
    },
  },
  "security.new_device": {
    en: {
      title: "A new phone can now sign in",
      body: "{device} was trusted for PIN sign-in. If this wasn't you, remove it in Security and change your PIN.",
    },
    so: {
      title: "Taleefan cusub ayaa geli kara akoonkaaga",
      body: "{device} ayaa hadda ku geli kara PIN-kaaga. Haddii aadan adigu samayn, ka saar qaybta Amniga, kadibna beddel PIN-kaaga.",
    },
    ar: {
      title: "هاتف جديد يمكنه تسجيل الدخول",
      body: "أصبح بإمكان {device} تسجيل الدخول برمز PIN. إذا لم تقم بذلك، احذفه من الأمان ثم غيّر رمز PIN.",
    },
  },
  "account.frozen_by_you": {
    en: {
      title: "Account frozen",
      body: "You froze your Zapp Pay account. No money can leave it until support unfreezes it.",
    },
    so: {
      title: "Akoonka waa la xannibay",
      body: "Waxaad xannibtay akoonkaaga Zapp Pay. Lacag kama bixi karto ilaa taageerada Zapp Pay ay furto.",
    },
    ar: {
      title: "تم تجميد الحساب",
      body: "تم تجميد حسابك في Zapp Pay بناءً على طلبك. لا يمكن خروج أي أموال منه حتى يرفع الدعم التجميد.",
    },
  },

  // Disputes
  "dispute.refund_requested": {
    en: { title: "Refund requested", body: "A customer asked for a refund of {amount}. Reply within {days}." },
    so: {
      title: "Lacag celin ayaa la codsaday",
      body: "Macmiil ayaa codsaday in loo celiyo {amount}. Ka jawaab {days} gudahood.",
    },
    ar: { title: "طلب استرداد", body: "طلب عميل استرداد {amount}. يرجى الرد خلال {days}." },
  },
  "dispute.payment_disputed": {
    en: { title: "A payment was disputed", body: "A customer disputed a payment of {amount}. Reply within {days}." },
    so: {
      title: "Cabasho ayaa laga keenay lacag-bixin",
      body: "Macmiil ayaa ka cabanaya lacag-bixin dhan {amount}. Ka jawaab {days} gudahood.",
    },
    ar: { title: "نزاع على دفعة", body: "فتح عميل نزاعًا على دفعة بقيمة {amount}. يرجى الرد خلال {days}." },
  },
  "dispute.new_reply": {
    en: { title: "Dispute update", body: "There's a new reply on a dispute." },
    so: { title: "Cabasho: jawaab cusub", body: "Jawaab cusub ayaa lagu soo daray cabasho." },
    ar: { title: "تحديث على نزاع", body: "هناك رد جديد على أحد النزاعات." },
  },
  "dispute.withdrawn": {
    en: { title: "Dispute withdrawn", body: "A dispute against you was withdrawn." },
    so: { title: "Cabashada waa laga noqday", body: "Cabasho lagaa keenay waa laga noqday." },
    ar: { title: "تم سحب النزاع", body: "تم سحب نزاع مرفوع ضدك." },
  },
  "dispute.not_upheld": {
    en: { title: "Dispute decided", body: "Your dispute was reviewed and not upheld." },
    so: { title: "Go'aan ayaa laga gaaray cabashada", body: "Cabashadaada waa la eegay, lagumase taageerin." },
    ar: { title: "صدر قرار في النزاع", body: "تمت مراجعة نزاعك ولم يتم قبوله." },
  },
  "dispute.not_upheld_against": {
    en: { title: "Dispute decided", body: "A dispute against you was not upheld." },
    so: { title: "Go'aan ayaa laga gaaray cabashada", body: "Cabashadii lagaa keenay lama taageerin." },
    ar: { title: "صدر قرار في النزاع", body: "لم يتم قبول نزاع مرفوع ضدك." },
  },
  "dispute.upheld": {
    en: { title: "Dispute decided", body: "Your dispute was upheld. {amount} is back in your wallet." },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "Cabashadaada waa lagu taageeray. {amount} waxay ku soo noqotay jeebkaaga.",
    },
    ar: { title: "صدر قرار في النزاع", body: "تم قبول نزاعك، وأُعيد مبلغ {amount} إلى محفظتك." },
  },
  "dispute.upheld_against": {
    en: {
      title: "Dispute decided",
      body: "A dispute against you was upheld and {amount} was returned to the customer.",
    },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "Cabashadii lagaa keenay waa la taageeray, macmiilkana waxaa loo celiyay {amount}.",
    },
    ar: { title: "صدر قرار في النزاع", body: "تم قبول نزاع مرفوع ضدك، وأُعيد مبلغ {amount} إلى العميل." },
  },
  "dispute.upheld_awaiting_funds": {
    en: {
      title: "Dispute decided",
      body: "Your dispute was upheld. {amount} will reach your wallet as soon as the other party has it.",
    },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "Cabashadaada waa lagu taageeray. {amount} waxay soo gaari doontaa jeebkaaga isla marka dhinaca kale lacagtu u soo gasho.",
    },
    ar: {
      title: "صدر قرار في النزاع",
      body: "تم قبول نزاعك. سيصل مبلغ {amount} إلى محفظتك فور توفره لدى الطرف الآخر.",
    },
  },
  "dispute.upheld_awaiting_funds_against": {
    en: {
      title: "Dispute decided",
      body: "A dispute against you was upheld. {amount} is owed and will be taken from your next payments.",
    },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "Cabashadii lagaa keenay waa la taageeray. Waxaa lagugu leeyahay {amount}, waxaana laga jari doonaa lacagaha kuu soo gala.",
    },
    ar: {
      title: "صدر قرار في النزاع",
      body: "تم قبول نزاع مرفوع ضدك. عليك مبلغ {amount} سيُخصم من دفعاتك القادمة.",
    },
  },
  "dispute.collected": {
    en: { title: "Dispute decided", body: "{amount} from your upheld dispute is now in your wallet." },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "{amount} oo ah lacagtii cabashadaada ayaa hadda soo gaartay jeebkaaga.",
    },
    ar: { title: "صدر قرار في النزاع", body: "وصل إلى محفظتك مبلغ {amount} من نزاعك المقبول." },
  },
  "dispute.collected_against": {
    en: { title: "Dispute decided", body: "{amount} owed on a dispute has now been paid." },
    so: {
      title: "Go'aan ayaa laga gaaray cabashada",
      body: "Lacagtii cabashada lagugu lahaa, {amount}, hadda waa la bixiyay.",
    },
    ar: { title: "صدر قرار في النزاع", body: "تم سداد مبلغ {amount} المستحق عليك في نزاع." },
  },

  // Corrections, float and payouts
  "adjustment.credit": {
    en: { title: "Balance corrected", body: "Zapp Pay added {amount} to your wallet." },
    so: { title: "Haraaga waa la saxay", body: "Zapp Pay waxay jeebkaaga ku dartay {amount}." },
    ar: { title: "تم تصحيح الرصيد", body: "أضافت Zapp Pay مبلغ {amount} إلى محفظتك." },
  },
  "adjustment.debit": {
    en: { title: "Balance corrected", body: "Zapp Pay took {amount} from your wallet to correct an error." },
    so: { title: "Haraaga waa la saxay", body: "Zapp Pay waxay jeebkaaga ka jartay {amount} si loo saxo khalad." },
    ar: { title: "تم تصحيح الرصيد", body: "خصمت Zapp Pay مبلغ {amount} من محفظتك لتصحيح خطأ." },
  },
  "float.issued": {
    en: { title: "Float added", body: "+{amount} float" },
    so: { title: "Float ayaa laguu kordhiyay", body: "Float-kaaga waxaa lagu daray {amount}." },
    ar: { title: "تمت إضافة رصيد تشغيلي", body: "أُضيف {amount} إلى رصيدك التشغيلي." },
  },
  "float.withdrawn": {
    en: { title: "Float withdrawn", body: "-{amount} float" },
    so: { title: "Float waa lagaa jaray", body: "Float-kaaga waxaa laga jaray {amount}." },
    ar: { title: "تم سحب رصيد تشغيلي", body: "سُحب {amount} من رصيدك التشغيلي." },
  },
  "payout.sent": {
    en: { title: "Payout sent", body: "{amount} is on its way via {route}." },
    so: { title: "Lacag-bixinta waa la diray", body: "{amount} ayaa laguugu soo dirayaa {route}." },
    ar: { title: "تم إرسال التحويل", body: "مبلغ {amount} في طريقه إليك عبر {route}." },
  },
  "payout.declined": {
    en: { title: "Payout declined", body: "{amount} is back in your balance. {reason}" },
    so: { title: "Lacag-bixinta waa la diiday", body: "{amount} waxay ku soo noqotay haraagaaga. {reason}" },
    ar: { title: "تم رفض التحويل", body: "أُعيد مبلغ {amount} إلى رصيدك. {reason}" },
  },
  "payout.auto_requested": {
    en: { title: "Automatic payout requested", body: "{amount} is on its way to {destination}." },
    so: { title: "Lacag-bixin toos ah ayaa la codsaday", body: "{amount} waxaa loo dirayaa {destination}." },
    ar: { title: "تم طلب تحويل تلقائي", body: "مبلغ {amount} في طريقه إلى {destination}." },
  },

  // Applications and standing
  "kyc.approved": {
    en: {
      title: "Identity verified",
      body: "Your identity is verified. Your transaction limits have increased.",
    },
    so: {
      title: "Aqoonsiga waa la xaqiijiyay",
      body: "Aqoonsigaaga waa la xaqiijiyay. Xadka macaamilladaada waa la kordhiyay.",
    },
    ar: { title: "تم التحقق من الهوية", body: "تم التحقق من هويتك، ورُفعت حدود معاملاتك." },
  },
  "kyc.rejected": {
    en: { title: "Verification unsuccessful", body: "We could not verify your documents. {reason}" },
    so: { title: "Xaqiijintu ma guulaysan", body: "Dukumeentiyadaada lama xaqiijin karin. {reason}" },
    ar: { title: "تعذّر التحقق من الهوية", body: "لم نتمكن من التحقق من مستنداتك. {reason}" },
  },
  "agent.listing_paused": {
    en: {
      title: "Your agent listing is paused",
      body: "Several disputes against you were upheld recently, so customers won't see you in Find Agent until Zapp Pay has reviewed them.",
    },
    so: {
      title: "Muuqashadaada liiska wakiillada waa la hakiyay",
      body: "Dhowr cabasho oo lagaa keenay ayaa dhowaan la taageeray. Sidaas darteed magacaaga lagama muujin doono liiska wakiillada ilaa Zapp Pay ay dib u eegto.",
    },
    ar: {
      title: "تم إيقاف ظهورك كوكيل مؤقتًا",
      body: "قُبلت مؤخرًا عدة نزاعات مرفوعة ضدك، لذا لن يظهر اسمك للعملاء في قائمة الوكلاء حتى تراجعها Zapp Pay.",
    },
  },
  "role.approved": {
    en: { title: "Account upgraded", body: "You can now use Zapp Pay as {role}." },
    so: { title: "Codsigaaga waa la aqbalay", body: "Hadda Zapp Pay waxaad u isticmaali kartaa {role} ahaan." },
    ar: { title: "تمت ترقية حسابك", body: "أصبح حسابك في Zapp Pay حساب {role}." },
  },
  "role.rejected": {
    en: { title: "Application not approved", body: "Your application was not approved. {reason}" },
    so: { title: "Codsigaaga lama aqbalin", body: "Codsigaaga lama aqbalin. {reason}" },
    ar: { title: "لم تتم الموافقة على طلبك", body: "لم تتم الموافقة على طلبك. {reason}" },
  },
} as const satisfies Record<string, Translations>;

export type PushTemplateKey = keyof typeof PUSH_TEMPLATES;

type PlaceholdersIn<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholdersIn<Rest>
  : never;

type Placeholders<K extends PushTemplateKey> = PlaceholdersIn<
  (typeof PUSH_TEMPLATES)[K]["en"]["title"] | (typeof PUSH_TEMPLATES)[K]["en"]["body"]
>;

/**
 * A template and the values for its placeholders. TypeScript holds each call
 * site to the placeholders its template has: none missing, none extra.
 */
export type PushMessage = {
  [K in PushTemplateKey]: [Placeholders<K>] extends [never]
    ? { key: K; params?: undefined }
    : { key: K; params: Record<Placeholders<K>, PushParam> };
}[PushTemplateKey];

// The params check above reads the English text's type, which is only exact
// for a plain string literal: `"a" + "b"` widens to string and would let any
// call site through. This fails to compile, naming the key, if one does.
type WidenedEnglish = {
  [K in PushTemplateKey]: string extends (typeof PUSH_TEMPLATES)[K]["en"][keyof PushText] ? K : never;
}[PushTemplateKey];
const englishIsLiteral: [WidenedEnglish] extends [never] ? true : WidenedEnglish = true;
void englishIsLiteral;

/** How a role reads after "as" (en), before "ahaan" (so) and after "حساب" (ar). */
export const ROLE_NAMES: Record<PrivilegedRole, Localized> = {
  merchant: { en: "a merchant", so: "ganacsade", ar: "تاجر" },
  topup_agent: { en: "a top-up agent", so: "wakiil ku-shubis", ar: "وكيل شحن" },
  agent_merchant: { en: "an agent and merchant", so: "wakiil iyo ganacsade", ar: "وكيل وتاجر" },
};

/** How a payout route reads after "via" (en), "laguugu soo dirayaa" (so) and "عبر" (ar). */
export const PAYOUT_ROUTE_NAMES: Record<FloatRouteName, Localized> = {
  zaad: { en: "Zaad", so: "Zaad", ar: "زاد" },
  edahab: { en: "eDahab", so: "eDahab", ar: "إي دهب" },
  bank: { en: "bank transfer", so: "bangiga", ar: "التحويل البنكي" },
  cash: { en: "cash", so: "lacag caddaan ah", ar: "الدفع النقدي" },
};

/** A newly trusted phone that its owner didn't name. */
export const UNNAMED_PHONE: Record<"ios" | "other", Localized> = {
  ios: { en: "An iPhone", so: "iPhone", ar: "جهاز iPhone" },
  other: { en: "A phone", so: "Taleefan", ar: "هاتف" },
};

/**
 * The language to write a user's pushes in, from their `preferredLanguage`.
 * Anything unset or unknown is English, as the apps treat it. Tolerates case
 * and region tags ("SO", "ar-SA") in case a future writer stores those.
 */
export function resolveLanguage(value: unknown): PreferredLanguage {
  if (typeof value !== "string") return "en";
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return (PUSH_LANGUAGES as readonly string[]).includes(primary) ? (primary as PreferredLanguage) : "en";
}

/**
 * A template's title and body in `language`. If that language's text can't
 * be filled, the English is sent rather than nothing.
 */
export function renderPush(message: PushMessage, language: PreferredLanguage): PushText {
  const template: Translations = PUSH_TEMPLATES[message.key];
  const params: Record<string, PushParam> = message.params ?? {};
  try {
    return fill(template[language] ?? template.en, params, language);
  } catch (err) {
    if (language === "en") throw err;
    console.error(`Push ${message.key} failed in ${language}; sending English:`, err);
    return fill(template.en, params, "en");
  }
}

function fill(text: PushText, params: Record<string, PushParam>, language: PreferredLanguage): PushText {
  const put = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params[name];
      if (value === undefined || value === null) throw new Error(`Missing push param {${name}}`);
      return formatParam(value, language);
    });
  return { title: put(text.title), body: put(text.body) };
}

function formatParam(value: PushParam, language: PreferredLanguage): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return formatMoment(value, language);
  if ("days" in value) return formatDays(value.days, language);
  return value[language] ?? value.en;
}

// Somaliland keeps East Africa Time, UTC+3, all year (no daylight saving).
const HARGEISA_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

// Fixed tables rather than Intl: ICU's Somali and Arabic date formats change
// between Node versions, and these must match what the tests pin.
const WEEKDAYS: Record<PreferredLanguage, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  so: ["Axad", "Isniin", "Talaado", "Arbaco", "Khamiis", "Jimce", "Sabti"],
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
};

const MONTHS: Record<PreferredLanguage, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  so: [
    "Jannaayo", "Febraayo", "Maarso", "Abriil", "Maayo", "Juun",
    "Luulyo", "Ogosto", "Sebteembar", "Oktoobar", "Noofeembar", "Diseembar",
  ],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};

/** "Thu 29 Oct, 13:05 (Hargeisa time)", with Latin digits in every language. */
export function formatMoment(date: Date, language: PreferredLanguage): string {
  const local = new Date(date.getTime() + HARGEISA_UTC_OFFSET_MS);
  const weekday = WEEKDAYS[language][local.getUTCDay()];
  const day = local.getUTCDate();
  const month = MONTHS[language][local.getUTCMonth()];
  const time = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  switch (language) {
    case "so":
      return `${weekday} ${day} ${month}, ${time} (waqtiga Hargeysa)`;
    case "ar":
      return `${weekday} ${day} ${month}، الساعة ${time} بتوقيت هرجيسا`;
    default:
      return `${weekday} ${day} ${month}, ${time} (Hargeisa time)`;
  }
}

/** "3 days", "3 maalmood", "3 أيام" — Arabic has its own forms for 1, 2, 3–10 and 11–99. */
export function formatDays(days: number, language: PreferredLanguage): string {
  switch (language) {
    case "so":
      return days === 1 ? "1 maalin" : `${days} maalmood`;
    case "ar": {
      const n = days % 100;
      if (days === 1) return "يوم واحد";
      if (days === 2) return "يومين";
      if (n >= 3 && n <= 10) return `${days} أيام`;
      if (n >= 11 && n <= 99) return `${days} يومًا`;
      return `${days} يوم`;
    }
    default:
      return days === 1 ? "1 day" : `${days} days`;
  }
}
