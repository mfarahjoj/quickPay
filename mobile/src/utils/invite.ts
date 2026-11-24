import { Alert, Linking, Platform } from 'react-native';
import type { TFunction } from 'i18next';

/**
 * Inviting someone to Zapp Pay: the message, and opening WhatsApp or texts
 * with it. Used by Invite & Earn and by Send money when the person picked
 * isn't on Zapp Pay yet. The message is in the sender's app language.
 */

export function inviteMessage(t: TFunction, referralCode?: string | null): string {
  const code = referralCode?.trim();
  return code ? t('invite.message', { code }) : t('invite.messageNoCode');
}

/** WhatsApp, straight into a chat with [phone] (E.164), the message written. */
export function whatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
}

/** A text message to [phone] (E.164), the message written. iOS and Android join the body differently. */
export function smsUrl(phone: string, message: string, os: string = Platform.OS): string {
  return `sms:${phone}${os === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
}

/**
 * "Amina isn't on Zapp Pay yet": invite them on WhatsApp or by text, or
 * leave it. Nothing is sent until the customer presses send in that app.
 * `text` replaces the title and body, e.g. "Invite Amina" from Invite & Earn.
 */
export function offerInvite(
  t: TFunction,
  person: { name: string; phone: string },
  message: string,
  text: { title?: string; body?: string } = {}
): void {
  Alert.alert(
    text.title ?? t('invite.notOnZappTitle', { name: person.name }),
    text.body ?? t('invite.notOnZappBody'),
    [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('invite.bySms'), onPress: () => Linking.openURL(smsUrl(person.phone, message)).catch(() => {}) },
      { text: t('invite.onWhatsApp'), onPress: () => Linking.openURL(whatsAppUrl(person.phone, message)).catch(() => {}) },
    ]
  );
}
