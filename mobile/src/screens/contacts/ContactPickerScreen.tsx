import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Contacts from 'react-native-contacts';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { useAuth } from '../../hooks/useAuth';
import { useUserProfile } from '../../hooks/useUserProfile';
import { ContactEntry, contactEntries, filterContacts } from '../../utils/contactPhone';
import { inviteMessage, offerInvite } from '../../utils/invite';
import { personInitials } from '../../utils/recentPeople';
import { formatLocal } from '../../services/mobileMoney.utils';
import { makeStyles, useColors } from '../../theme';

type Purpose = 'send' | 'invite';

/** "Sahra (London)" → "SL": initials from words, not brackets or emoji. A bare number keeps its last digits. */
function initialsFor(name: string): string {
  if (name.startsWith('+')) return personInitials(name);
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  return personInitials(words || name);
}
type State = 'loading' | 'ready' | 'denied' | 'blocked' | 'failed';

interface Props {
  navigation: any;
  route: { params?: { purpose?: Purpose } };
}

/**
 * Pick someone from the phone's contacts: to send them money (Send money's
 * phone step takes it from there, with the same lookup a typed number gets),
 * or to invite them on WhatsApp or by text.
 *
 * Contacts are read on the phone and stay there. Permission is asked here,
 * when the customer has chosen to use their contacts, never at start-up.
 */
export default function ContactPickerScreen({ navigation, route }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const purpose: Purpose = route.params?.purpose === 'invite' ? 'invite' : 'send';

  const [state, setState] = useState<State>('loading');
  const [entries, setEntries] = useState<ContactEntry[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      let allowed: boolean;
      if (Platform.OS === 'android') {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
        allowed = result === PermissionsAndroid.RESULTS.GRANTED;
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          setState('blocked');
          return;
        }
      } else {
        let status = await Contacts.checkPermission();
        if (status === 'undefined') status = await Contacts.requestPermission();
        // "limited": iOS lets people share only some contacts; those are enough.
        allowed = status === 'authorized' || status === 'limited';
        if (!allowed) {
          setState('blocked');
          return;
        }
      }
      if (!allowed) {
        setState('denied');
        return;
      }
      const contacts = await Contacts.getAllWithoutPhotos();
      setEntries(contactEntries(contacts, user?.phoneNumber));
      setState('ready');
    } catch {
      setState('failed');
    }
  }, [user?.phoneNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => filterContacts(entries, query), [entries, query]);

  const pick = (entry: ContactEntry) => {
    if (purpose === 'send') {
      // Send money looks the number up, exactly as if it had been typed.
      navigation.navigate('MainTabs', {
        screen: 'Payments',
        params: { pickedContact: { name: entry.name, phone: entry.phone, at: Date.now() } },
      });
      return;
    }
    offerInvite(t, entry, inviteMessage(t, profile?.referralCode), {
      title: t('contacts.inviteTitle', { name: entry.name }),
      body: t('contacts.inviteBody'),
    });
  };

  const title = purpose === 'send' ? t('contacts.titleSend') : t('contacts.titleInvite');

  return (
    <View style={styles.container}>
      <Header title={title} onBack={() => navigation.goBack()} />

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ui.accent} />
        </View>
      ) : state === 'denied' || state === 'blocked' || state === 'failed' ? (
        <View style={styles.center}>
          <Text style={styles.stateTitle}>
            {state === 'failed' ? t('contacts.failedTitle') : t('contacts.deniedTitle')}
          </Text>
          <Text style={styles.stateBody}>
            {state === 'failed' ? t('contacts.failedBody') : t('contacts.deniedBody')}
          </Text>
          <TouchableOpacity
            style={styles.stateButton}
            onPress={() => (state === 'blocked' ? Linking.openSettings().catch(() => {}) : load())}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.stateButtonText}>
              {state === 'blocked' ? t('contacts.openSettings') : t('common.tryAgain')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder={t('contacts.search')}
              placeholderTextColor={colors.ui.textFaint}
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              accessibilityLabel={t('contacts.search')}
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(e) => e.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.divider} />}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {entries.length === 0 ? t('contacts.none') : t('contacts.noMatch')}
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => pick(item)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={
                  purpose === 'send'
                    ? t('contacts.sendTo', { name: item.name })
                    : t('contacts.inviteTitle', { name: item.name })
                }
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsFor(item.name)}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.number} numberOfLines={1}>
                    {formatLocal(item.phone)}
                    {item.label ? `  ·  ${item.label}` : ''}
                  </Text>
                </View>
                {purpose === 'invite' ? (
                  <View style={styles.invitePill}>
                    <Text style={styles.invitePillText}>{t('contacts.invite')}</Text>
                  </View>
                ) : (
                  <Text style={styles.chevron}>›</Text>
                )}
              </TouchableOpacity>
            )}
          />
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.ui.canvas },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
    stateTitle: { fontSize: 18, fontWeight: '700', color: colors.ui.text, textAlign: 'center' },
    stateBody: { fontSize: 15, lineHeight: 21, color: colors.ui.textDim, textAlign: 'center' },
    stateButton: {
      marginTop: 8,
      paddingHorizontal: 22,
      paddingVertical: 12,
      borderRadius: 22,
      backgroundColor: colors.ui.accent,
    },
    stateButtonText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
    searchWrap: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
    search: {
      height: 44,
      borderRadius: 12,
      paddingHorizontal: 14,
      fontSize: 16,
      color: colors.ui.text,
      backgroundColor: colors.ui.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.ui.glassBorder,
    },
    list: { paddingHorizontal: 16, paddingBottom: 40 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.divider, marginLeft: 56 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.tints.coral.fill,
    },
    avatarText: { fontSize: 15, fontWeight: '700', color: colors.tints.coral.mark },
    rowText: { flex: 1 },
    name: { fontSize: 16, fontWeight: '600', color: colors.ui.text },
    number: { fontSize: 13, color: colors.ui.textFaint, marginTop: 2 },
    chevron: { fontSize: 22, color: colors.ui.ink(0.25), fontWeight: '300' },
    invitePill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: colors.ui.accentSoft,
    },
    invitePillText: { fontSize: 14, fontWeight: '700', color: colors.ui.accentText },
    empty: { textAlign: 'center', color: colors.ui.textDim, fontSize: 15, marginTop: 40 },
  })
);
