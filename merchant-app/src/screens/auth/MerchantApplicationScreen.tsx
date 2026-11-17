import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DarkScreen, GlassCard, PillButton, ScreenHeader, ACCENT, GLASS, GLASS_BORDER, TEXT_DIM } from '../../components/DarkScreen';
import { Input } from '../../components/Input';
import { PhotoCapture } from '../../components/PhotoCapture';
import { CheckIcon } from '../../components/icons/AuthIcons';
import { confirmSignOut } from '../../utils/confirmSignOut';
import {
  currentPosition,
  getPreviousApplication,
  isAgentRole,
  isMerchantRole,
  submitRoleApplication,
  uploadApplicationPhoto,
  type AgentService,
  type ApplicantRole,
  type GeoPin,
  type IdType,
  type PhotoKind,
} from '../../services/roleApplication.service';
import { logger } from '../../utils/logger';

interface Props {
  role: ApplicantRole;
  /** Already KYC-verified: the ID step is skipped. */
  kycVerified: boolean;
}

type Step = 'business' | 'money' | 'id' | 'review';

const BUSINESS_TYPES = ['shop', 'restaurant', 'pharmacy', 'electronics', 'clothing', 'services', 'other'] as const;
const ID_TYPES: IdType[] = ['national_id', 'passport', 'drivers_license'];

interface Photo {
  /** Local file, for the thumbnail. */
  uri: string;
  /** Storage path once uploaded. */
  path?: string;
  uploading: boolean;
  failed?: boolean;
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
 * The merchant / agent application, all in one place: business, payout (or,
 * for agents, hours and the Zaad number customers pay into), ID and a review.
 * Zapp approves it once in the console, and approval sets everything up.
 */
export default function MerchantApplicationScreen({ role, kycVerified }: Props) {
  const { t } = useTranslation();
  const merchant = isMerchantRole(role);
  const agent = isAgentRole(role);
  const steps: Step[] = useMemo(
    () => (kycVerified ? ['business', 'money', 'review'] : ['business', 'money', 'id', 'review']),
    [kycVerified]
  );
  const [step, setStep] = useState<Step>('business');
  const index = steps.indexOf(step);

  // Business
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<string>('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [location, setLocation] = useState<GeoPin | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Money
  const [payoutProvider, setPayoutProvider] = useState<'zaad' | 'edahab'>('zaad');
  const [payoutNumber, setPayoutNumber] = useState('');
  const [openHours, setOpenHours] = useState('');
  const [services, setServices] = useState<AgentService[]>(['cash_in', 'cash_out']);
  const [zaadReceive, setZaadReceive] = useState('');

  // ID
  const [idType, setIdType] = useState<IdType>('national_id');
  const [idNumber, setIdNumber] = useState('');

  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, Photo>>>({});
  const [camera, setCamera] = useState<PhotoKind | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A re-application starts with what they sent last time.
  useEffect(() => {
    let live = true;
    getPreviousApplication(role).then((prev) => {
      if (!live || !prev) return;
      setBusinessName(prev.businessName ?? '');
      setBusinessType(prev.businessType ?? '');
      setAddress(prev.businessAddress ?? '');
      setArea(prev.area ?? '');
      setLocation(prev.location ?? null);
      if (prev.payout) {
        setPayoutProvider(prev.payout.provider);
        setPayoutNumber(prev.payout.number.replace(/^\+252/, '0'));
      }
      if (prev.agent) {
        setOpenHours(prev.agent.openHours ?? '');
        if (prev.agent.services?.length) setServices(prev.agent.services);
        setZaadReceive(prev.agent.zaadReceiveNumber?.replace(/^\+252/, '0') ?? '');
      }
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

  const pinLocation = async () => {
    setLocating(true);
    setLocationError(null);
    try {
      setLocation(await currentPosition());
    } catch (err) {
      logger.warn('Location failed:', err);
      setLocationError(t('application.business.locationFailed'));
    } finally {
      setLocating(false);
    }
  };

  const validate = (s: Step): boolean => {
    const e: Record<string, string> = {};
    const req = t('application.required');
    if (s === 'business') {
      if (businessName.trim().length < 2) e.businessName = req;
      if (!businessType) e.businessType = req;
      if (address.trim().length < 3) e.address = req;
      if (area.trim().length < 2) e.area = req;
      if (!photos.shop?.path) e.shop = t('application.photo.needed');
      if (!location) e.location = t('application.business.locationNeeded');
    }
    if (s === 'money') {
      if (merchant && !looksLikeMsisdn(payoutNumber)) e.payoutNumber = t('application.badNumber');
      if (agent) {
        if (openHours.trim().length < 2) e.openHours = req;
        if (services.length === 0) e.services = req;
        if (zaadReceive.trim() && !looksLikeMsisdn(zaadReceive)) e.zaadReceive = t('application.badNumber');
      }
    }
    if (s === 'id') {
      if (idNumber.trim().length < 3) e.idNumber = req;
      if (!photos.front?.path) e.front = t('application.photo.needed');
      if (idType !== 'passport' && !photos.back?.path) e.back = t('application.photo.needed');
      if (!photos.selfie?.path) e.selfie = t('application.photo.needed');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep(steps[index + 1]);
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
        businessType: t(`application.business.types.${businessType}`, { lng: 'en' }),
        businessAddress: address.trim(),
        area: area.trim(),
        location,
        shopPhotoPath: photos.shop!.path!,
        ...(merchant ? { payout: { provider: payoutProvider, number: payoutNumber } } : {}),
        ...(agent
          ? { agent: { openHours: openHours.trim(), services, ...(zaadReceive.trim() ? { zaadReceiveNumber: zaadReceive } : {}) } }
          : {}),
        ...(kycVerified
          ? {}
          : {
              id: {
                idType,
                idNumber: idNumber.trim(),
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
                  <ActivityIndicator color="#FFF" />
                </View>
              )}
              {photo.path && (
                <View style={styles.photoDone}>
                  <CheckIcon size={14} color="#000" />
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

  const chip = (selected: boolean, label: string, onPress: () => void, key?: string) => (
    <TouchableOpacity
      key={key ?? label}
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

  const reviewRow = (label: string, value: string) => (
    <View style={styles.reviewRow} key={label}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value || '—'}</Text>
    </View>
  );

  return (
    <DarkScreen edges={['top', 'bottom']} keyboard>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          onBack={back}
          title={t(`application.${step}.title`)}
          subtitle={t(`application.${step}.subtitle`, { role: t(`application.role.${role}`) })}
        />

        <View style={styles.progress}>
          {steps.map((s, i) => (
            <View key={s} style={[styles.progressDot, i <= index && styles.progressDotOn]} />
          ))}
        </View>

        {step === 'business' && (
          <View style={styles.section}>
            <Input
              label={t('application.business.name')}
              value={businessName}
              onChangeText={setBusinessName}
              autoCapitalize="words"
              error={errors.businessName}
            />
            <Text style={styles.label}>{t('application.business.type')}</Text>
            <View style={styles.chips}>
              {BUSINESS_TYPES.map((b) => chip(businessType === b, t(`application.business.types.${b}`), () => setBusinessType(b), b))}
            </View>
            {!!errors.businessType && <Text style={styles.err}>{errors.businessType}</Text>}
            <Input label={t('application.business.address')} value={address} onChangeText={setAddress} error={errors.address} />
            <Input label={t('application.business.area')} value={area} onChangeText={setArea} autoCapitalize="words" error={errors.area} />

            <Text style={styles.label}>{t('application.business.location')}</Text>
            <GlassCard style={styles.locationCard}>
              <Text style={styles.locationText}>
                {location
                  ? t('application.business.locationSet', {
                      coords: `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`,
                    })
                  : t('application.business.locationHint')}
              </Text>
              <PillButton
                label={location ? t('application.business.locationAgain') : t('application.business.locationButton')}
                onPress={pinLocation}
                loading={locating}
                variant="glass"
              />
            </GlassCard>
            {!!(locationError || errors.location) && <Text style={styles.err}>{locationError || errors.location}</Text>}

            <View style={styles.photoRow}>{photoSlot('shop', t('application.photo.shop'))}</View>
          </View>
        )}

        {step === 'money' && (
          <View style={styles.section}>
            {merchant && (
              <>
                <Text style={styles.sectionTitle}>{t('application.money.payoutTitle')}</Text>
                <Text style={styles.sectionHint}>{t('application.money.payoutHint')}</Text>
                <View style={styles.chips}>
                  {chip(payoutProvider === 'zaad', 'Zaad', () => setPayoutProvider('zaad'))}
                  {chip(payoutProvider === 'edahab', 'eDahab', () => setPayoutProvider('edahab'))}
                </View>
                <Input
                  label={t('application.money.payoutNumber')}
                  value={payoutNumber}
                  onChangeText={setPayoutNumber}
                  keyboardType="phone-pad"
                  placeholder="063 412 3456"
                  error={errors.payoutNumber}
                />
              </>
            )}
            {agent && (
              <>
                <Text style={styles.sectionTitle}>{t('application.money.agentTitle')}</Text>
                <Input
                  label={t('application.money.openHours')}
                  value={openHours}
                  onChangeText={setOpenHours}
                  placeholder={t('application.money.openHoursPlaceholder')}
                  error={errors.openHours}
                />
                <Text style={styles.label}>{t('application.money.services')}</Text>
                <View style={styles.chips}>
                  {(['cash_in', 'cash_out'] as AgentService[]).map((s) =>
                    chip(
                      services.includes(s),
                      t(`application.money.${s}`),
                      () => setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])),
                      s
                    )
                  )}
                </View>
                {!!errors.services && <Text style={styles.err}>{errors.services}</Text>}
                <Input
                  label={t('application.money.zaadReceive')}
                  value={zaadReceive}
                  onChangeText={setZaadReceive}
                  keyboardType="phone-pad"
                  placeholder="063 412 3456"
                  error={errors.zaadReceive}
                />
                <Text style={styles.sectionHint}>{t('application.money.zaadReceiveHint')}</Text>
              </>
            )}
          </View>
        )}

        {step === 'id' && (
          <View style={styles.section}>
            <Text style={styles.label}>{t('application.id.type')}</Text>
            <View style={styles.chips}>
              {ID_TYPES.map((it) => chip(idType === it, t(`application.id.types.${it}`), () => setIdType(it), it))}
            </View>
            <Input
              label={t('application.id.number')}
              value={idNumber}
              onChangeText={setIdNumber}
              autoCapitalize="characters"
              error={errors.idNumber}
            />
            <View style={styles.photoRow}>
              {photoSlot('front', t('application.photo.front'))}
              {idType !== 'passport' && photoSlot('back', t('application.photo.back'))}
              {photoSlot('selfie', t('application.photo.selfie'))}
            </View>
          </View>
        )}

        {step === 'review' && (
          <View style={styles.section}>
            <GlassCard>
              {reviewRow(t('application.review.applyingAs'), t(`application.role.${role}`))}
              {reviewRow(t('application.business.name'), businessName)}
              {reviewRow(t('application.business.type'), businessType ? t(`application.business.types.${businessType}`) : '')}
              {reviewRow(t('application.business.address'), `${address}, ${area}`)}
              {merchant && reviewRow(t('application.money.payoutNumber'), `${payoutProvider === 'zaad' ? 'Zaad' : 'eDahab'} · ${payoutNumber}`)}
              {agent && reviewRow(t('application.money.openHours'), openHours)}
              {agent && reviewRow(t('application.money.services'), services.map((s) => t(`application.money.${s}`)).join(', '))}
              {agent && !!zaadReceive && reviewRow(t('application.money.zaadReceive'), zaadReceive)}
              {!kycVerified && reviewRow(t('application.id.number'), `${t(`application.id.types.${idType}`)} · ${idNumber}`)}
            </GlassCard>
            <Text style={styles.sectionHint}>{t('application.review.whatNext')}</Text>
            {!!submitError && <Text style={styles.err}>{submitError}</Text>}
          </View>
        )}

        <View style={styles.footer}>
          {step === 'review' ? (
            <PillButton label={t('application.review.submit')} onPress={submit} loading={submitting} />
          ) : (
            <PillButton
              label={t('application.next')}
              onPress={next}
              disabled={Object.values(photos).some((p) => p?.uploading)}
            />
          )}
        </View>
      </ScrollView>

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

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 20 },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)' },
  progressDotOn: { backgroundColor: ACCENT },
  section: { gap: 14 },
  sectionTitle: { color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 4 },
  sectionHint: { color: TEXT_DIM, fontSize: 14, lineHeight: 20 },
  label: { color: TEXT_DIM, fontSize: 13, fontWeight: '600', marginBottom: -6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  chipOn: { backgroundColor: '#FFF', borderColor: '#FFF' },
  chipText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#000' },
  locationCard: { gap: 12 },
  locationText: { color: '#FFF', fontSize: 14, lineHeight: 20 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  photoSlot: { width: 100, alignItems: 'center', gap: 6 },
  photoBox: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  photoDone: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#5DCAA5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlus: { color: '#FFF', fontSize: 28 },
  photoLabel: { color: '#FFF', fontSize: 13, textAlign: 'center' },
  err: { color: '#FF8A80', fontSize: 13 },
  reviewRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GLASS_BORDER },
  reviewLabel: { color: TEXT_DIM, fontSize: 12 },
  reviewValue: { color: '#FFF', fontSize: 15, marginTop: 2 },
  footer: { marginTop: 'auto', paddingTop: 24 },
});
