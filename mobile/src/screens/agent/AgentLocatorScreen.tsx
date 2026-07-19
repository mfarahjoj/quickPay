import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { firestore } from '../../services/firebase.config';
import { triggerHaptic } from '../../services/haptics.service';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { Springs } from '../../constants/springs';

interface Agent {
  id: string;
  fullName: string;
  phoneNumber: string;
  agentInfo: {
    area: string;
    openHours: string;
    services: ('cash_in' | 'cash_out')[];
    isActive: boolean;
    businessName?: string;
  };
}

const HARGEISA_AREAS = [
  'All Areas',
  'Sha\'ab',
  'Jigjiga Yar',
  '26 June',
  'Ahmed Dhagah',
  'Mohamoud Haybe',
  'Hodan',
  'Golaha',
  'New Hargeisa',
  'Beer Khalaf',
];

function AnimatedAgentRow({ agent, index }: { agent: Agent; index: number }) {
  const opacity = useSharedValue(0);
  const y = useSharedValue(12);

  useEffect(() => {
    const delay = Math.min(index * 50, 400);
    opacity.value = withDelay(delay, withTiming(1, { duration: 220 }));
    y.value = withDelay(delay, withSpring(0, Springs.transition));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  const handleCall = () => {
    triggerHaptic('medium');
    Linking.openURL(`tel:${agent.phoneNumber}`);
  };

  const hasCashIn = agent.agentInfo.services.includes('cash_in');
  const hasCashOut = agent.agentInfo.services.includes('cash_out');

  return (
    <Animated.View style={[styles.agentCard, animStyle]}>
      <View style={styles.agentLeft}>
        <View style={styles.agentAvatar}>
          <Text style={styles.agentAvatarText}>
            {(agent.agentInfo.businessName || agent.fullName).charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.agentCenter}>
        <Text style={styles.agentName} numberOfLines={1}>
          {agent.agentInfo.businessName || agent.fullName}
        </Text>
        <Text style={styles.agentArea}>{agent.agentInfo.area}</Text>
        <Text style={styles.agentHours}>{agent.agentInfo.openHours}</Text>
        <View style={styles.servicePills}>
          {hasCashIn && (
            <View style={[styles.servicePill, styles.cashInPill]}>
              <Text style={styles.cashInPillText}>Cash In</Text>
            </View>
          )}
          {hasCashOut && (
            <View style={[styles.servicePill, styles.cashOutPill]}>
              <Text style={styles.cashOutPillText}>Cash Out</Text>
            </View>
          )}
        </View>
      </View>
      <TouchableOpacity style={styles.callBtn} onPress={handleCall} activeOpacity={0.7}>
        <Text style={styles.callBtnText}>Call</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function AgentLocatorScreen() {
  const navigation = useNavigation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedArea, setSelectedArea] = useState('All Areas');
  const [search, setSearch] = useState('');

  const fetchAgents = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('users')
        .where('accountType', 'in', ['topup_agent', 'agent_merchant'])
        .where('isActive', '==', true)
        .get();

      const list: Agent[] = snap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Agent, 'id'>) }))
        .filter((u) => u.agentInfo?.isActive !== false);

      list.sort((a, b) =>
        (a.agentInfo?.area || '').localeCompare(b.agentInfo?.area || '')
      );

      setAgents(list);
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAgents();
  };

  const filtered = agents.filter((a) => {
    const matchArea = selectedArea === 'All Areas' || a.agentInfo?.area === selectedArea;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      a.fullName.toLowerCase().includes(q) ||
      (a.agentInfo?.businessName || '').toLowerCase().includes(q) ||
      (a.agentInfo?.area || '').toLowerCase().includes(q);
    return matchArea && matchSearch;
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Find Agent</Text>
          <Text style={styles.headerSub}>Cash in or cash out near you</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or area..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Area filter */}
      <FlatList
        horizontal
        data={HARGEISA_AREAS}
        keyExtractor={(item) => item}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.areaList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.areaChip, selectedArea === item && styles.areaChipActive]}
            onPress={() => { triggerHaptic('light'); setSelectedArea(item); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.areaChipText, selectedArea === item && styles.areaChipTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Agent list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.dark.accentText || '#FF8A7A'} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No agents found</Text>
          <Text style={styles.emptySub}>Try a different area or search term</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="rgba(255,255,255,0.4)"
            />
          }
          renderItem={({ item, index }) => (
            <AnimatedAgentRow agent={item} index={index} />
          )}
        />
      )}
    </View>
  );
}

const ACCENT = '#FF8A7A';
const INCOMING = '#34C77B';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 24,
    color: '#FFFFFF',
    lineHeight: 28,
  },
  headerText: { flex: 1 },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },

  searchWrap: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    height: 44,
    justifyContent: 'center',
  },
  searchInput: {
    color: '#FFFFFF',
    fontSize: 15,
    padding: 0,
  },

  areaList: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  areaChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  areaChipActive: {
    backgroundColor: 'rgba(111,155,255,0.18)',
    borderColor: 'rgba(111,155,255,0.5)',
  },
  areaChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
  },
  areaChipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },

  listContent: { paddingHorizontal: 20, paddingBottom: 40 },

  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  agentLeft: {},
  agentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(111,155,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: ACCENT,
  },
  agentCenter: { flex: 1 },
  agentName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  agentArea: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 2,
  },
  agentHours: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 6,
  },
  servicePills: { flexDirection: 'row', gap: 6 },
  servicePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  cashInPill: { backgroundColor: 'rgba(52,199,123,0.15)', borderWidth: 1, borderColor: 'rgba(52,199,123,0.3)' },
  cashInPillText: { fontSize: 10, fontWeight: '600', color: INCOMING },
  cashOutPill: { backgroundColor: 'rgba(111,155,255,0.15)', borderWidth: 1, borderColor: 'rgba(111,155,255,0.3)' },
  cashOutPillText: { fontSize: 10, fontWeight: '600', color: ACCENT },

  callBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(111,155,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(111,155,255,0.4)',
  },
  callBtnText: { fontSize: 13, fontWeight: '600', color: ACCENT },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  emptySub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
});
