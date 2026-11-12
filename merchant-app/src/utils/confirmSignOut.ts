import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { signOut } from '../services/auth.service';

/**
 * Sign out after asking. Several onboarding screens use sign-out as their
 * back button — it is the only way out before the account is set up — and a
 * stray tap should not throw away a half-finished sign-up.
 */
export function confirmSignOut(t: TFunction): void {
  Alert.alert(t('settings.signOutConfirmTitle'), t('settings.signOutConfirmMessage'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('settings.signOut'), style: 'destructive', onPress: () => signOut() },
  ]);
}
