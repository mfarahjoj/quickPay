import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { functions } from '../../services/firebase.config';
import { DarkScreen, GlassCard, PillButton, ACCENT, TEXT_DIM, TEXT_FAINT } from '../../components';

type Step = 'build' | 'review' | 'pin' | 'processing' | 'result';

interface Employee {
  id: string;
  name: string;
  phone: string;
  amount: string; // display string, e.g. "50.00"
}

interface PayrollResult {
  phone: string;
  name?: string;
  amount: number;
  status: 'success' | 'failed';
  reason?: string;
}

const CURRENCY = 'USD';

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseCents(val: string): number {
  const n = parseFloat(val.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function newEmployee(): Employee {
  return { id: Math.random().toString(36).slice(2), name: '', phone: '', amount: '' };
}

interface Props {
  navigation: any;
}

export default function PayrollScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>('build');
  const [employees, setEmployees] = useState<Employee[]>([newEmployee()]);
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PayrollResult[]>([]);
  const [summary, setSummary] = useState<{ totalPaid: number; successCount: number; failedCount: number } | null>(null);

  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fadeIn.setValue(0);
    Animated.timing(fadeIn, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [step]);

  const totalCents = employees.reduce((sum, e) => sum + parseCents(e.amount), 0);
  const validEmployees = employees.filter(
    (e) => e.phone.trim().length >= 9 && parseCents(e.amount) > 0
  );

  // ─── Employee list mutations ────────────────────────────
  const updateEmployee = (id: string, field: keyof Employee, value: string) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const addRow = () => setEmployees((prev) => [...prev, newEmployee()]);

  const removeRow = (id: string) => {
    if (employees.length === 1) return;
    setEmployees((prev) => prev.filter((e) => e.id !== id));
  };

  // ─── Navigation between steps ──────────────────────────
  const goReview = () => {
    if (validEmployees.length === 0) {
      Alert.alert('No valid entries', 'Add at least one employee with a phone number and amount.');
      return;
    }
    setStep('review');
  };

  const goPin = () => setStep('pin');

  const handleRunPayroll = async () => {
    if (pin.length < 4) return;
    setStep('processing');
    try {
      const fn = functions().httpsCallable('payrollPayout');
      const res = await fn({
        employees: validEmployees.map((e) => ({
          phone: e.phone.trim(),
          amount: parseCents(e.amount),
          name: e.name.trim() || undefined,
        })),
        currency: CURRENCY,
        pin,
        payrollLabel: label.trim() || undefined,
      });
      const data = res.data as any;
      setResults(data.data.results);
      setSummary({
        totalPaid: data.data.totalPaid,
        successCount: data.data.successCount,
        failedCount: data.data.failedCount,
      });
      setStep('result');
    } catch (e: any) {
      Alert.alert('Payroll failed', e.message || 'Could not process payroll.');
      setStep('pin');
    }
  };

  // ─── Render ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (step === 'build') navigation.goBack();
            else if (step === 'review') setStep('build');
            else if (step === 'pin') setStep('review');
            else if (step === 'result') navigation.goBack();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {step === 'build' ? 'Payroll'
            : step === 'review' ? 'Review'
            : step === 'pin' ? 'Confirm'
            : step === 'processing' ? 'Processing…'
            : 'Done'}
        </Text>
        <View style={styles.headerRight} />
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeIn }}>

        {/* ── BUILD STEP ──────────────────────────────── */}
        {step === 'build' && (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stepTitle}>Add employees</Text>
            <Text style={styles.stepSubtitle}>Enter phone numbers and salary amounts. Only Zapp Pay accounts receive funds.</Text>

            {/* Payroll label */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>PAYROLL LABEL (OPTIONAL)</Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.input}
                  value={label}
                  onChangeText={setLabel}
                  placeholder="e.g. June 2026 Salaries"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                />
              </View>
            </View>

            {/* Employee rows */}
            {employees.map((emp, index) => (
              <GlassCard key={emp.id} style={styles.empCard}>
                <View style={styles.empCardHeader}>
                  <Text style={styles.empIndex}>{index + 1}</Text>
                  {employees.length > 1 && (
                    <TouchableOpacity onPress={() => removeRow(emp.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.removeBtn}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.empRow}>
                  <View style={[styles.inputBox, { flex: 1, marginRight: 8 }]}>
                    <TextInput
                      style={styles.input}
                      value={emp.name}
                      onChangeText={(v) => updateEmployee(emp.id, 'name', v)}
                      placeholder="Name (optional)"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      autoCapitalize="words"
                    />
                  </View>
                </View>

                <View style={[styles.empRow, { marginTop: 10 }]}>
                  <View style={[styles.inputBox, { flex: 1, marginRight: 8 }]}>
                    <TextInput
                      style={styles.input}
                      value={emp.phone}
                      onChangeText={(v) => updateEmployee(emp.id, 'phone', v)}
                      placeholder="+252 63 000 0000"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={[styles.inputBox, { width: 100, flexDirection: 'row', alignItems: 'center', paddingLeft: 10 }]}>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, marginRight: 2 }}>$</Text>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={emp.amount}
                      onChangeText={(v) => updateEmployee(emp.id, 'amount', v)}
                      placeholder="0.00"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </GlassCard>
            ))}

            <TouchableOpacity style={styles.addRow} onPress={addRow} activeOpacity={0.7}>
              <Text style={styles.addRowText}>+ Add Employee</Text>
            </TouchableOpacity>

            {/* Total */}
            <GlassCard style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total payout</Text>
              <Text style={styles.totalAmount}>{formatUsd(totalCents)}</Text>
              <Text style={styles.totalSub}>{validEmployees.length} of {employees.length} entries valid</Text>
            </GlassCard>

            <PillButton
              label={`Review Payroll (${validEmployees.length})`}
              onPress={goReview}
              disabled={validEmployees.length === 0}
              style={{ marginTop: 12 }}
            />
          </ScrollView>
        )}

        {/* ── REVIEW STEP ─────────────────────────────── */}
        {step === 'review' && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.stepTitle}>Review payroll</Text>
            {label ? <Text style={styles.labelBadge}>{label}</Text> : null}
            <Text style={styles.stepSubtitle}>
              {formatUsd(validEmployees.reduce((s, e) => s + parseCents(e.amount), 0))} will be deducted from your balance.
            </Text>

            {validEmployees.map((emp, i) => (
              <GlassCard key={emp.id} style={styles.reviewRow}>
                <View style={styles.reviewLeft}>
                  <Text style={styles.reviewName}>{emp.name || emp.phone}</Text>
                  {emp.name ? <Text style={styles.reviewPhone}>{emp.phone}</Text> : null}
                </View>
                <Text style={styles.reviewAmount}>{formatUsd(parseCents(emp.amount))}</Text>
              </GlassCard>
            ))}

            <PillButton label="Confirm & Enter PIN" onPress={goPin} style={{ marginTop: 16 }} />
          </ScrollView>
        )}

        {/* ── PIN STEP ────────────────────────────────── */}
        {step === 'pin' && (
          <View style={styles.pinContainer}>
            <Text style={styles.stepTitle}>Enter your PIN</Text>
            <Text style={styles.stepSubtitle}>
              Authorise payment of {formatUsd(validEmployees.reduce((s, e) => s + parseCents(e.amount), 0))} to {validEmployees.length} employees.
            </Text>

            <View style={styles.pinDots}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[styles.pinDot, i < pin.length && styles.pinDotFilled]} />
              ))}
            </View>

            {/* Numpad */}
            <View style={styles.numpad}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.numKey, !k && styles.numKeyBlank]}
                  activeOpacity={k ? 0.7 : 1}
                  onPress={() => {
                    if (!k) return;
                    if (k === '⌫') {
                      setPin((p) => p.slice(0, -1));
                    } else if (pin.length < 6) {
                      const next = pin + k;
                      setPin(next);
                      if (next.length === 6) {
                        // auto-submit at 6 digits
                        setTimeout(() => handleRunPayroll(), 100);
                      }
                    }
                  }}
                >
                  {k ? <Text style={styles.numKeyText}>{k}</Text> : null}
                </TouchableOpacity>
              ))}
            </View>

            <PillButton
              label="Run Payroll"
              onPress={handleRunPayroll}
              disabled={pin.length < 4 || loading}
              style={{ marginTop: 24 }}
            />
          </View>
        )}

        {/* ── PROCESSING ──────────────────────────────── */}
        {step === 'processing' && (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={styles.processingText}>Processing {validEmployees.length} transfers…</Text>
            <Text style={styles.processingSubtext}>This may take a moment</Text>
          </View>
        )}

        {/* ── RESULT ──────────────────────────────────── */}
        {step === 'result' && summary && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Summary banner */}
            <GlassCard style={[styles.resultBanner, summary.failedCount === 0 && styles.resultBannerSuccess]}>
              <Text style={styles.resultEmoji}>{summary.failedCount === 0 ? '✓' : '⚠'}</Text>
              <Text style={styles.resultBannerTitle}>
                {summary.failedCount === 0 ? 'Payroll complete' : 'Partially complete'}
              </Text>
              <Text style={styles.resultBannerSub}>
                {summary.successCount} paid · {summary.failedCount} failed · {formatUsd(summary.totalPaid)} sent
              </Text>
            </GlassCard>

            {results.map((r, i) => (
              <GlassCard key={i} style={[styles.reviewRow, r.status === 'failed' && styles.reviewRowFailed]}>
                <View style={styles.reviewLeft}>
                  <Text style={styles.reviewName}>{r.name || r.phone}</Text>
                  {r.reason ? <Text style={styles.errorReason}>{r.reason}</Text> : null}
                </View>
                <View style={styles.resultRight}>
                  <Text style={[styles.reviewAmount, r.status === 'failed' && styles.amountFailed]}>
                    {formatUsd(r.amount)}
                  </Text>
                  <Text style={r.status === 'success' ? styles.statusOk : styles.statusFail}>
                    {r.status === 'success' ? '✓' : '✕'}
                  </Text>
                </View>
              </GlassCard>
            ))}

            <PillButton label="Done" onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
          </ScrollView>
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  backBtn: { width: 32, justifyContent: 'center' },
  backChevron: { fontSize: 34, color: '#fff', fontWeight: '300', lineHeight: 38 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  headerRight: { width: 32 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48 },

  stepTitle: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -1, marginBottom: 8 },
  stepSubtitle: { fontSize: 14, color: TEXT_DIM, lineHeight: 21, marginBottom: 24 },
  labelBadge: {
    alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', color: '#FF8A7A',
    backgroundColor: 'rgba(26,86,255,0.15)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10,
  },

  field: { marginBottom: 20 },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', color: TEXT_FAINT, marginBottom: 8 },

  inputBox: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14, height: 48, justifyContent: 'center',
  },
  input: { fontSize: 15, color: '#fff', padding: 0 },

  empCard: { padding: 16, marginBottom: 12 },
  empCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  empIndex: { fontSize: 13, fontWeight: '700', color: TEXT_FAINT },
  removeBtn: { fontSize: 14, color: 'rgba(255,59,48,0.7)', fontWeight: '600' },
  empRow: { flexDirection: 'row' },

  addRow: {
    borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(26,86,255,0.3)',
    borderStyle: 'dashed', padding: 14, alignItems: 'center', marginBottom: 20,
  },
  addRowText: { fontSize: 14, fontWeight: '600', color: '#5B8AFF' },

  totalCard: { padding: 20, alignItems: 'center', marginBottom: 8 },
  totalLabel: { fontSize: 12, color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  totalAmount: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  totalSub: { fontSize: 13, color: TEXT_DIM, marginTop: 4 },

  reviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginBottom: 8 },
  reviewRowFailed: { borderColor: 'rgba(255,69,58,0.3)', backgroundColor: 'rgba(255,69,58,0.06)' },
  reviewLeft: { flex: 1, marginRight: 12 },
  reviewName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  reviewPhone: { fontSize: 12, color: TEXT_FAINT, marginTop: 2 },
  reviewAmount: { fontSize: 17, fontWeight: '700', color: '#fff' },
  resultRight: { alignItems: 'flex-end', gap: 2 },
  amountFailed: { color: 'rgba(255,255,255,0.3)' },
  errorReason: { fontSize: 12, color: '#FF6961', marginTop: 3 },
  statusOk: { fontSize: 13, color: '#30D158', fontWeight: '700' },
  statusFail: { fontSize: 13, color: '#FF453A', fontWeight: '700' },

  resultBanner: { padding: 20, alignItems: 'center', marginBottom: 16 },
  resultBannerSuccess: { borderColor: 'rgba(48,209,88,0.3)', backgroundColor: 'rgba(48,209,88,0.08)' },
  resultEmoji: { fontSize: 32, marginBottom: 8 },
  resultBannerTitle: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 6 },
  resultBannerSub: { fontSize: 14, color: TEXT_DIM },

  pinContainer: { flex: 1, paddingHorizontal: 24, paddingTop: 20, alignItems: 'center' },
  pinDots: { flexDirection: 'row', gap: 14, marginVertical: 32 },
  pinDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  pinDotFilled: { backgroundColor: '#fff', borderColor: '#fff' },

  numpad: { flexDirection: 'row', flexWrap: 'wrap', width: 280, gap: 0 },
  numKey: {
    width: 280 / 3, height: 68,
    justifyContent: 'center', alignItems: 'center',
  },
  numKeyBlank: { opacity: 0 },
  numKeyText: { fontSize: 24, fontWeight: '400', color: '#fff' },

  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  processingText: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 16 },
  processingSubtext: { fontSize: 14, color: TEXT_DIM },
});
