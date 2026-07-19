import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import { useAuth } from '../../hooks/useAuth';
import { useUserProfile } from '../../hooks/useUserProfile';
import { functions, storage } from '../../services/firebase.config';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { KycStatus } from '../../types';

async function pickFromGallery(): Promise<string | null> {
  try {
    const { launchImageLibrary } = await import('react-native-image-picker');
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (result.didCancel || !result.assets?.length) return null;
    return result.assets[0].uri ?? null;
  } catch {
    return null;
  }
}

async function pickFromCamera(): Promise<string | null> {
  try {
    const { launchCamera } = await import('react-native-image-picker');
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    if (result.didCancel || !result.assets?.length) return null;
    return result.assets[0].uri ?? null;
  } catch {
    return null;
  }
}

interface Props {
  navigation: any;
}

type IdType = 'national_id' | 'passport' | 'drivers_license';

const ID_TYPE_KEYS: { value: IdType; labelKey: string }[] = [
  { value: 'national_id', labelKey: 'profile.kyc.nationalId' },
  { value: 'passport', labelKey: 'profile.kyc.passport' },
  { value: 'drivers_license', labelKey: 'profile.kyc.driversLicense' },
];

const STATUS_LABEL_KEYS: Record<KycStatus, string> = {
  pending: 'kyc.status.notSubmitted',
  submitted: 'kyc.status.submitted',
  verified: 'kyc.status.verified',
  rejected: 'kyc.status.rejected',
};

const STATUS_DESC_KEYS: Record<KycStatus, string> = {
  pending: 'kyc.status.pendingDesc',
  submitted: 'kyc.status.submittedDesc',
  verified: 'kyc.status.verifiedDesc',
  rejected: 'kyc.status.rejectedDesc',
};

const STATUS_COLORS: Record<KycStatus, string> = {
  pending: colors.text.tertiary,
  submitted: colors.warning,
  verified: colors.success,
  rejected: colors.dark.error,
};

export default function KYCScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile } = useUserProfile();

  const [idType, setIdType] = useState<IdType>('national_id');
  const [idNumber, setIdNumber] = useState('');
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [backPhoto, setBackPhoto] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const kycStatus = (profile?.kycStatus ?? 'pending') as KycStatus;
  const canSubmit = kycStatus === 'pending' || kycStatus === 'rejected';

  const pickImage = async (setter: (uri: string | null) => void) => {
    Alert.alert(t('profile.kyc.selectPhoto'), t('profile.kyc.chooseSource'), [
      {
        text: t('common.camera'),
        onPress: async () => {
          const uri = await pickFromCamera();
          if (uri) setter(uri);
          else Alert.alert(t('common.unavailable'), t('profile.kyc.imagePickerUnavailable'));
        },
      },
      {
        text: t('common.gallery'),
        onPress: async () => {
          const uri = await pickFromGallery();
          if (uri) setter(uri);
          else Alert.alert(t('common.unavailable'), t('profile.kyc.imagePickerUnavailable'));
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const uploadFile = async (localUri: string, path: string): Promise<string> => {
    const ref = storage().ref(path);
    await ref.putFile(localUri);
    return await ref.getDownloadURL();
  };

  const handleSubmit = async () => {
    if (!idNumber.trim() || idNumber.trim().length < 3) {
      Alert.alert(t('common.error'), t('profile.kyc.validIdRequired'));
      return;
    }
    if (!frontPhoto) {
      Alert.alert(t('common.error'), t('profile.kyc.frontPhotoRequired'));
      return;
    }
    if (!selfie) {
      Alert.alert(t('common.error'), t('profile.kyc.selfieRequired'));
      return;
    }

    try {
      setLoading(true);
      const uid = user!.uid;
      const ts = Date.now();

      const frontUrl = await uploadFile(
        frontPhoto,
        `kyc/${uid}/front_${ts}.jpg`
      );
      const backUrl = backPhoto
        ? await uploadFile(backPhoto, `kyc/${uid}/back_${ts}.jpg`)
        : undefined;
      const selfieUrl = await uploadFile(selfie, `kyc/${uid}/selfie_${ts}.jpg`);

      const submitKYCFn = functions().httpsCallable('submitKYC');
      const result = await submitKYCFn({
        idType,
        idNumber: idNumber.trim(),
        frontPhotoUrl: frontUrl,
        backPhotoUrl: backUrl,
        selfieUrl,
      });

      const data = result.data as { success: boolean; error?: string };
      if (data.success) {
        Alert.alert(t('common.submitted'), t('profile.kyc.submittedMessage'), [
          { text: t('common.ok'), onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert(t('common.error'), data.error ?? t('profile.kyc.submissionFailed'));
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message ?? t('profile.kyc.submitFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title={t('profile.kyc.title')} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[kycStatus] }]} />
          <View style={styles.statusContent}>
            <Text style={styles.statusLabel}>{t(STATUS_LABEL_KEYS[kycStatus])}</Text>
            <Text style={styles.statusDesc}>{t(STATUS_DESC_KEYS[kycStatus])}</Text>
          </View>
        </View>

        {!canSubmit ? (
          <View style={styles.doneCard}>
            <Text style={styles.doneText}>
              {kycStatus === 'verified'
                ? t('profile.kyc.verifiedNoAction')
                : t('profile.kyc.underReviewWait')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('profile.kyc.idType')}</Text>
            <View style={styles.chipRow}>
              {ID_TYPE_KEYS.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[styles.chip, idType === item.value && styles.chipSelected]}
                  onPress={() => setIdType(item.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      idType === item.value && styles.chipTextSelected,
                    ]}
                  >
                    {t(item.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('profile.kyc.idNumber')}</Text>
            <TextInput
              style={styles.input}
              value={idNumber}
              onChangeText={setIdNumber}
              placeholder={t('profile.kyc.idNumberPlaceholder')}
              placeholderTextColor={colors.text.tertiary}
            />

            <Text style={styles.sectionTitle}>{t('profile.kyc.uploadDocuments')}</Text>

            <Text style={styles.label}>{t('profile.kyc.frontOfId')}</Text>
            <TouchableOpacity
              style={styles.photoBox}
              onPress={() => pickImage(setFrontPhoto)}
            >
              {frontPhoto ? (
                <Image source={{ uri: frontPhoto }} style={styles.photoPreview} />
              ) : (
                <Text style={styles.photoPlaceholder}>{t('profile.kyc.tapAddPhoto')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.label}>{t('profile.kyc.backOfIdOptional')}</Text>
            <TouchableOpacity
              style={styles.photoBox}
              onPress={() => pickImage(setBackPhoto)}
            >
              {backPhoto ? (
                <Image source={{ uri: backPhoto }} style={styles.photoPreview} />
              ) : (
                <Text style={styles.photoPlaceholder}>{t('profile.kyc.tapAddPhoto')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.label}>{t('profile.kyc.selfie')}</Text>
            <TouchableOpacity
              style={styles.photoBox}
              onPress={() => pickImage(setSelfie)}
            >
              {selfie ? (
                <Image source={{ uri: selfie }} style={styles.photoPreview} />
              ) : (
                <Text style={styles.photoPlaceholder}>{t('profile.kyc.tapTakeSelfie')}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.submitContainer}>
              <Button
                title={t('profile.kyc.submitForReview')}
                onPress={handleSubmit}
                loading={loading}
                fullWidth
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.dark.canvas },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusCard: {
    flexDirection: 'row',
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    marginRight: spacing.md,
  },
  statusContent: { flex: 1 },
  statusLabel: { ...typography.bodySemibold, color: colors.dark.text },
  statusDesc: { ...typography.caption, color: colors.dark.textDim, marginTop: spacing.xs },
  doneCard: {
    backgroundColor: colors.dark.glass,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  doneText: { ...typography.body, color: colors.dark.textDim, textAlign: 'center' },
  sectionTitle: {
    ...typography.h3,
    color: colors.dark.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.captionBold,
    color: colors.dark.textDim,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.dark.text,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    backgroundColor: colors.dark.glass,
  },
  chipSelected: {
    backgroundColor: colors.dark.accentSoft,
    borderColor: colors.dark.accentBorder,
  },
  chipText: { ...typography.caption, color: colors.dark.textDim },
  chipTextSelected: { color: colors.dark.accentText, fontWeight: '600' },
  photoBox: {
    height: 160,
    backgroundColor: colors.dark.glass,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.dark.glassBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { ...typography.body, color: colors.dark.textFaint },
  submitContainer: { marginTop: spacing.xl },
});
