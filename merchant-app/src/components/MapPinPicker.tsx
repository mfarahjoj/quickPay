import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import MapView, { type Region } from 'react-native-maps';
import { PillButton, ACCENT, TEXT_DIM } from './DarkScreen';
import { CloseIcon } from './icons/AuthIcons';
import { currentPosition, type GeoPin } from '../services/roleApplication.service';
import { logger } from '../utils/logger';

/** Hargeisa, when there's no pin yet and the phone won't say where it is. */
const HARGEISA: GeoPin = { lat: 9.5624, lng: 44.077 };
const ZOOMED = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

interface Props {
  visible: boolean;
  /** Where to open: the current pin, else the phone's position, else Hargeisa. */
  initial: GeoPin | null;
  onClose: () => void;
  onConfirm: (pin: GeoPin) => void;
}

/**
 * A map with a fixed pin in the middle: move the map until the pin sits on
 * the shop's door, then confirm. Apple Maps on iPhone, Google Maps on Android.
 */
export function MapPinPicker({ visible, initial, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [locating, setLocating] = useState(false);

  const regionAt = (p: GeoPin): Region => ({ latitude: p.lat, longitude: p.lng, ...ZOOMED });

  const goToMe = async (animate: boolean) => {
    setLocating(true);
    try {
      const me = await currentPosition();
      if (animate) mapRef.current?.animateToRegion(regionAt(me), 400);
      else setRegion(regionAt(me));
    } catch (err) {
      logger.warn('Map: no position', err);
      if (!animate) setRegion(regionAt(HARGEISA));
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (initial) setRegion(regionAt(initial));
    else void goToMe(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.root}>
        {region ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            onRegionChangeComplete={setRegion}
            showsUserLocation
            showsPointsOfInterests
            toolbarEnabled={false}
          />
        ) : (
          <ActivityIndicator style={styles.loading} color="#FFF" />
        )}

        {/* The pin is fixed to the centre; the map moves under it. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <View style={styles.pinHead} />
          <View style={styles.pinStem} />
        </View>

        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View style={styles.top}>
            <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <CloseIcon size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.banner}>
              <Text style={styles.title}>{t('application.map.title')}</Text>
              <Text style={styles.hint}>{t('application.map.hint')}</Text>
            </View>
          </View>

          <View style={styles.bottom}>
            <PillButton
              label={t('application.map.toMe')}
              onPress={() => void goToMe(true)}
              loading={locating}
              variant="glass"
            />
            <PillButton
              label={t('application.map.confirm')}
              onPress={() => region && onConfirm({ lat: region.latitude, lng: region.longitude })}
              disabled={!region}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  loading: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 16, padding: 14 },
  title: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  hint: { color: TEXT_DIM, fontSize: 14, marginTop: 4 },
  pinWrap: { position: 'absolute', top: '50%', left: '50%', marginLeft: -14, marginTop: -44, alignItems: 'center' },
  pinHead: { width: 28, height: 28, borderRadius: 14, backgroundColor: ACCENT, borderWidth: 4, borderColor: '#FFF' },
  pinStem: { width: 3, height: 16, backgroundColor: '#FFF' },
  bottom: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
});
