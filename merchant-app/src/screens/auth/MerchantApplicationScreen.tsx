import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DarkScreen, GlassCard, PillButton, ScreenHeader } from '../../components/DarkScreen';
import { Input } from '../../components/Input';
import { PhotoCapture } from '../../components/PhotoCapture';
import { MapPinPicker } from '../../components/MapPinPicker';
import { CheckIcon } from '../../components/icons/AuthIcons';
import { confirmSignOut } from '../../utils/confirmSignOut';
import {
  addressAt,
  currentPosition,
  getPreviousApplication,
  searchPlaces,
  isAgentRole,
  isMerchantRole,
  submitRoleApplication,
  uploadApplicationPhoto,
  type ApplicantRole,
  type GeoPin,
  type IdType,
  type PhotoKind,
  type PlaceResult,
} from '../../services/roleApplication.service';
import { logger } from '../../utils/logger';
import { auth, firestore } from '../../services/firebase.config';
import { makeStyles, useColors } from '../../theme';

/**
 * "Find your shop on Google" needs the GOOGLE_MAPS_API_KEY secret and the
 * placesSearch function deployed. Off until then; the map pin works without
 * it (Apple Maps on iPhone), it just won't fill in the address.
 */
const GOOGLE_SEARCH_ENABLED = false;

interface Props {
  role: ApplicantRole;
  /** Already KYC-verified: the ID step is skipped. */
  kycVerified: boolean;
}

type Step = 'shop' | 'id';

interface Photo {
  /** Local file, for the thumbnail. */
  uri: string;
  /** Storage path once uploaded. */
  path?: string;
  uploading: boolean;
  failed?: boolean;
}

/** Google's category ("Pharmacy", "Clothing store") as a business type. */
function typeFromCategory(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (/pharmac|drug|chemist/.test(c)) return 'Pharmacy';
  if (/restaurant|caf|coffee|food|bakery|juice|tea/.test(c)) return 'Restaurant / café';
  if (/electronic|phone|mobile|computer/.test(c)) return 'Electronics';
  if (/cloth|fashion|shoe|tailor|boutique/.test(c)) return 'Clothing';
  if (/store|shop|market|grocery|supermarket/.test(c)) return 'Shop';
  return c ? category! : 'Shop';
}

/** "+252634123456" → "0634123456"; other numbers as they are. */
function localNumber(e164?: string | null): string {
  if (!e164) return '';
  return e164.startsWith('+252') ? `0${e164.slice(4)}` : '';
}

/** Somali mobile number, as the server reads it: 9 digits after +252 / 0. */
function looksLikeMsisdn(raw: string): boolean {
  let d = raw.replace(/[^0-9]/g, '');
  if (d.startsWith('00252')) d = d.slice(5);
  else if (d.startsWith('252') && d.length === 12) d = d.slice(3);
  if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  return /^[1-9]\d{8}$/.test(d);
}

/**
 * The merchant / agent application, in two short steps: the shop (name, pin,
 * photo, the number money goes to) and the ID (three photos). Zapp approves
 * it once in the console, and approval sets everything up.
 */
export default function MerchantApplicationScreen({ role, kycVerified }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useTranslation();
  const merchant = isMerchantRole(role);
  const agent = isAgentRole(role);
  const steps: Step[] = kycVerified ? ['shop'] : ['shop', 'id'];
  const [step, setStep] = useState<Step>('shop');
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;

  // Shop
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('Shop');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [location, setLocation] = useState<GeoPin | null>(null);
  const [locating, setLocating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [foundOnGoogle, setFoundOnGoogle] = useState(false);

  // One number. A shop's takings are paid to it; an agent's customers pay
  // into it (Zaad only). Starts as the number they signed up with.
  const [payoutProvider, setPayoutProvider] = useState<'zaad' | 'edahab'>('zaad');
  const [moneyNumber, setMoneyNumber] = useState(() => localNumber(auth().currentUser?.phoneNumber));
  const receivesOnZaad = agent && (!merchant || payoutProvider === 'zaad');
  // The account's Zaad account (number + registered name), where payouts go.
  // Saved with the application, so the app doesn't ask for it again later.
  const [zaadOnFile, setZaadOnFile] = useState(false);
  const [zaadName, setZaadName] = useState('');
  const numberIsZaad = receivesOnZaad || (merchant && payoutProvider === 'zaad');
  const askZaadName = numberIsZaad && !zaadOnFile;

  // ID: national ID by default; the number is read off the photo by Zapp.
  const [idType, setIdType] = useState<IdType>('national_id');

  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, Photo>>>({});
  const [camera, setCamera] = useState<PhotoKind | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Their name, and a Zaad account already on file (reused, not asked again).
  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) return;
    let live = true;
    firestore()
      .collection('users')
      .doc(uid)
      .get()
      .then((snap) => {
        const d = snap.data();
        if (!live || !d) return;
        if (d.zaad?.msisdn && d.zaad?.name) {
          setZaadOnFile(true);
          setMoneyNumber((cur) => cur || localNumber(d.zaad.msisdn));
        } else if (typeof d.fullName === 'string') {
          setZaadName((cur) => cur || d.fullName.trim());
        }
      })
      .catch((err) => logger.warn('Application: user read failed', err));
    return () => {
      live = false;
    };
  }, []);

  // A re-application starts with what they sent last time.
  useEffect(() => {
    let live = true;
    getPreviousApplication(role).then((prev) => {
      if (!live || !prev) return;
      setBusinessName(prev.businessName ?? '');
      if (prev.businessType) setBusinessType(prev.businessType);
      setAddress(prev.businessAddress ?? '');
      setArea(prev.area ?? '');
      setLocation(prev.location ?? null);
      const prevNumber = prev.payout?.number ?? prev.agent?.zaadReceiveNumber;
      if (prev.payout) setPayoutProvider(prev.payout.provider);
      if (prevNumber) setMoneyNumber(localNumber(prevNumber));
    });
    return () => {
      live = false;
    };
  }, [role]);

  const takePhoto = async (kind: PhotoKind, filePath: string) => {
    setCamera(null);
    const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    setPhotos((p) => ({ ...p, [kind]: { uri, uploading: true } }));
    setErrors((e) => ({ ...e, [kind]: '' }));
    try {
      const path = await uploadApplicationPhoto(kind, filePath);
      setPhotos((p) => ({ ...p, [kind]: { uri, path, uploading: false } }));
    } catch (err) {
      logger.warn('Photo upload failed:', err);
      setPhotos((p) => ({ ...p, [kind]: { uri, uploading: false, failed: true } }));
    }
  };

  // Find the shop on Google: one tap fills name, address, area and pin.
  const runSearch = async () => {
    const q = search.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const near = location ?? (await currentPosition().catch(() => null));
      const found = await searchPlaces(q, near);
      setResults(found);
      if (found.length === 0) setSearchError(t('application.find.none'));
    } catch (err: any) {
      logger.warn('Place search failed:', err);
      setResults([]);
      setSearchError(err?.message || t('application.find.failed'));
    } finally {
      setSearching(false);
    }
  };

  const pickPlace = (p: PlaceResult) => {
    setBusinessName(p.name);
    if (p.address) setAddress(p.address);
    if (p.area) setArea(p.area);
    if (p.location) setLocation(p.location);
    setBusinessType(typeFromCategory(p.category));
    setResults([]);
    setSearch('');
    setFoundOnGoogle(true);
    setErrors({});
  };

  // The map pin. With Google on, the address and area come from it.
  const confirmPin = async (pin: GeoPin) => {
    setMapOpen(false);
    setLocation(pin);
    setErrors((e) => ({ ...e, location: '' }));
    if (!GOOGLE_SEARCH_ENABLED || (address.trim() && area.trim())) return;
    setLocating(true);
    try {
      const at = await addressAt(pin);
      if (!address.trim() && at.address) setAddress(at.address);
      if (!area.trim() && at.area) setArea(at.area);
    } catch (err) {
      logger.warn('Address lookup failed:', err);
    } finally {
      setLocating(false);
    }
  };

  const validate = (s: Step): boolean => {
    const e: Record<string, string> = {};
    if (s === 'shop') {
      if (businessName.trim().length < 2) e.businessName = t('application.required');
      if (!location) e.location = t('application.business.locationNeeded');
      if (!photos.shop?.path) e.shop = t('application.photo.needed');
      if (!looksLikeMsisdn(moneyNumber)) e.moneyNumber = t('application.badNumber');
      if (askZaadName && zaadName.trim().split(/\s+/).filter(Boolean).length < 2) {
        e.zaadName = t('zaadAccount.invalidName');
      }
    }
    if (s === 'id') {
      if (!photos.front?.path) e.front = t('application.photo.needed');
      if (idType !== 'passport' && !photos.back?.path) e.back = t('application.photo.needed');
      if (!photos.selfie?.path) e.selfie = t('application.photo.needed');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const back = () => {
    if (index === 0) confirmSignOut(t);
    else setStep(steps[index - 1]);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitRoleApplication({
        requestedRole: role,
        businessName: businessName.trim(),
        businessType,
        businessAddress: address.trim(),
        area: area.trim(),
        location,
        shopPhotoPath: photos.shop!.path!,
        ...(askZaadName ? { zaadName: zaadName.trim() } : {}),
        ...(merchant ? { payout: { provider: payoutProvider, number: moneyNumber } } : {}),
        // Customers can only pay an agent on Zaad.
        ...(agent ? { agent: receivesOnZaad ? { zaadReceiveNumber: moneyNumber } : {} } : {}),
        ...(kycVerified
          ? {}
          : {
              id: {
                idType,
                frontPath: photos.front!.path!,
                ...(idType !== 'passport' && photos.back?.path ? { backPath: photos.back.path } : {}),
                selfiePath: photos.selfie!.path!,
              },
            }),
      });
      // The gate listens to the user document and swaps in the review screen.
    } catch (err: any) {
      setSubmitError(err?.message || t('application.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onPrimary = () => {
    if (!validate(step)) return;
    if (last) void submit();
    else setStep(steps[index + 1]);
  };

  const photoSlot = (kind: PhotoKind, label: string) => {
    const photo = photos[kind];
    return (
      <View style={styles.photoSlot}>
        <TouchableOpacity style={styles.photoBox} onPress={() => setCamera(kind)} accessibilityRole="button" accessibilityLabel={label}>
          {photo ? (
            <>
              <Image source={{ uri: photo.uri }} style={styles.photoImg} />
              {photo.uploading && (
                <View style={styles.photoOverlay}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
              {photo.path && (
                <View style={styles.photoDone}>
                  <CheckIcon size={14} color={colors.ui.onSolid} />
                </View>
              )}
            </>
          ) : (
            <Text style={styles.photoPlus}>＋</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.photoLabel}>{label}</Text>
        {photo?.failed && <Text style={styles.err}>{t('application.photo.uploadFailed')}</Text>}
        {!!errors[kind] && <Text style={styles.err}>{errors[kind]}</Text>}
      </View>
    );
  };

  const chip = (selected: boolean, label: string, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      style={[styles.chip, selected && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  const cameraMeta: Record<PhotoKind, { title: string; hint: string; facing: 'front' | 'back' }> = {
    shop: { title: t('application.photo.shopTitle'), hint: t('application.photo.shopHint'), facing: 'back' },
    front: { title: t('application.photo.frontTitle'), hint: t('application.photo.cardHint'), facing: 'back' },
    back: { title: t('application.photo.backTitle'), hint: t('application.photo.cardHint'), facing: 'back' },
    selfie: { title: t('application.photo.selfieTitle'), hint: t('application.photo.selfieHint'), facing: 'front' },
  };

  const moneyHint =
    role === 'merchant'
      ? 'application.money.hintShop'
      : role === 'topup_agent'
        ? 'application.money.hintAgent'
        : receivesOnZaad
          ? 'application.money.hintBoth'
          : 'application.money.hintBothEdahab';

  return (
    <DarkScreen edges={['top', 'bottom']} keyboard>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          onBack={back}
          title={t(`application.${step}.title`)}
          subtitle={t(`application.${step}.subtitle`, { role: t(`application.role.${role}`) })}
        />

        {steps.length > 1 && (
          <View style={styles.progress}>
            {steps.map((s, i) => (
              <View key={s} style={[styles.progressDot, i <= index && styles.progressDotOn]} />
            ))}
          </View>
        )}

        {step === 'shop' && (
          <View style={styles.section}>
            {GOOGLE_SEARCH_ENABLED && (
              <GlassCard style={styles.findCard}>
                <Text style={styles.sectionTitle}>{t('application.find.title')}</Text>
                <View style={styles.findRow}>
                  <View style={styles.findInput}>
                    <Input
                      value={search}
                      onChangeText={setSearch}
                      placeholder={t('application.find.placeholder')}
                      returnKeyType="search"
                      onSubmitEditing={() => void runSearch()}
                      autoCorrect={false}
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.findBtn}
                    onPress={() => void runSearch()}
                    disabled={searching || search.trim().length < 2}
                    accessibilityRole="button"
                    accessibilityLabel={t('application.find.button')}
                  >
                    {searching ? <ActivityIndicator color={colors.ui.onSolid} /> : <Text style={styles.findBtnText}>{t('application.find.button')}</Text>}
                  </TouchableOpacity>
                </View>
                {results.map((r) => (
                  <TouchableOpacity key={r.placeId} style={styles.result} onPress={() => pickPlace(r)} accessibilityRole="button">
                    <Text style={styles.resultName}>{r.name}</Text>
                    <Text style={styles.resultAddr} numberOfLines={2}>
                      {[r.category, r.address].filter(Boolean).join(' · ')}
                    </Text>
                  </TouchableOpacity>
                ))}
                {!!searchError && <Text style={styles.sectionHint}>{searchError}</Text>}
                {foundOnGoogle && <Text style={styles.foundNote}>{t('application.find.filled')}</Text>}
              </GlassCard>
            )}

            <Input
              label={t('application.business.name')}
              value={businessName}
              onChangeText={setBusinessName}
              autoCapitalize="words"
              error={errors.businessName}
            />

            <TouchableOpacity
              style={[styles.pinRow, !!errors.location && styles.pinRowError]}
              onPress={() => setMapOpen(true)}
              accessibilityRole="button"
            >
              <View style={styles.pinDot} />
              <View style={styles.pinText}>
                <Text style={styles.pinTitle}>
                  {location ? t('application.business.locationAgain') : t('application.business.locationButton')}
                </Text>
                <Text style={styles.pinSub} numberOfLines={2}>
                  {location
                    ? address || area || `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                    : t('application.business.locationHint')}
                </Text>
              </View>
              {locating ? <ActivityIndicator color={colors.ui.text} /> : location ? <CheckIcon size={18} color={colors.ui.incoming} /> : null}
            </TouchableOpacity>
            {!!errors.location && <Text style={styles.err}>{errors.location}</Text>}

            <Input
              label={t('application.business.landmark')}
              value={address}
              onChangeText={setAddress}
              placeholder={t('application.business.landmarkPlaceholder')}
            />

            {merchant && (
              <View style={styles.chips}>
                {chip(payoutProvider === 'zaad', 'Zaad', () => setPayoutProvider('zaad'))}
                {chip(payoutProvider === 'edahab', 'eDahab', () => setPayoutProvider('edahab'))}
              </View>
            )}
            <Input
              label={t(payoutProvider === 'edahab' && merchant ? 'application.money.edahabNumber' : 'application.money.zaadNumber')}
              value={moneyNumber}
              onChangeText={setMoneyNumber}
              keyboardType="phone-pad"
              placeholder="063 412 3456"
              error={errors.moneyNumber}
            />
            {askZaadName && (
              <Input
                label={t('zaadAccount.nameLabel')}
                value={zaadName}
                onChangeText={setZaadName}
                autoCapitalize="words"
                placeholder={t('zaadAccount.namePlaceholder')}
                error={errors.zaadName}
              />
            )}
            <Text style={styles.sectionHint}>{t(moneyHint)}</Text>

            <View style={styles.photoRow}>{photoSlot('shop', t('application.photo.shop'))}</View>
          </View>
        )}

        {step === 'id' && (
          <View style={styles.section}>
            <View style={styles.photoRow}>
              {photoSlot('front', t(idType === 'passport' ? 'application.photo.passport' : 'application.photo.front'))}
              {idType !== 'passport' && photoSlot('back', t('application.photo.back'))}
              {photoSlot('selfie', t('application.photo.selfie'))}
            </View>
            <TouchableOpacity
              onPress={() => setIdType(idType === 'passport' ? 'national_id' : 'passport')}
              accessibilityRole="button"
            >
              <Text style={styles.link}>
                {t(idType === 'passport' ? 'application.id.useNationalId' : 'application.id.usePassport')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          {last && <Text style={styles.sectionHint}>{t('application.review.whatNext')}</Text>}
          {!!submitError && <Text style={styles.err}>{submitError}</Text>}
          <PillButton
            label={last ? t('application.review.submit') : t('application.next')}
            onPress={onPrimary}
            loading={submitting}
            disabled={Object.values(photos).some((p) => p?.uploading)}
          />
        </View>
      </ScrollView>

      <MapPinPicker visible={mapOpen} initial={location} onClose={() => setMapOpen(false)} onConfirm={(p) => void confirmPin(p)} />

      {camera && (
        <PhotoCapture
          visible
          facing={cameraMeta[camera].facing}
          title={cameraMeta[camera].title}
          hint={cameraMeta[camera].hint}
          onClose={() => setCamera(null)}
          onCaptured={(path) => void takePhoto(camera, path)}
        />
      )}
    </DarkScreen>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 20 },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.ui.ink(0.12) },
  progressDotOn: { backgroundColor: colors.ui.accent },
  section: { gap: 14 },
  sectionTitle: { color: colors.ui.text, fontSize: 17, fontWeight: '700' },
  sectionHint: { color: colors.ui.textDim, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  chipOn: { backgroundColor: colors.ui.solid, borderColor: colors.ui.solid },
  chipText: { color: colors.ui.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.ui.onSolid },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
  },
  pinRowError: { borderColor: colors.ui.error },
  pinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.ui.accent, borderWidth: 3, borderColor: '#FFFFFF' },
  pinText: { flex: 1 },
  pinTitle: { color: colors.ui.text, fontSize: 15, fontWeight: '600' },
  pinSub: { color: colors.ui.textDim, fontSize: 13, marginTop: 2 },
  findCard: { gap: 10 },
  findRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  findInput: { flex: 1 },
  findBtn: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.ui.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findBtnText: { color: colors.ui.onSolid, fontWeight: '700', fontSize: 15 },
  result: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.glassBorder },
  resultName: { color: colors.ui.text, fontSize: 15, fontWeight: '600' },
  resultAddr: { color: colors.ui.textDim, fontSize: 13, marginTop: 2 },
  foundNote: { color: colors.ui.incoming, fontSize: 13 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  photoSlot: { width: 100, alignItems: 'center', gap: 6 },
  photoBox: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: colors.ui.glass,
    borderWidth: 1,
    borderColor: colors.ui.glassBorder,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDone: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ui.incoming,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlus: { color: colors.ui.text, fontSize: 28 },
  photoLabel: { color: colors.ui.text, fontSize: 13, textAlign: 'center' },
  link: { color: colors.ui.text, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  err: { color: colors.ui.error, fontSize: 13 },
  footer: { marginTop: 'auto', paddingTop: 24, gap: 10 },
}));
