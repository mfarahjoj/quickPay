import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';
import { useIdleSignOut } from '../hooks/useIdleSignOut';
import { useDeviceIntegrity } from '../hooks/useDeviceIntegrity';
import { ConsentGate } from '../components/legal/ConsentGate';
import { usePinSetupDone } from '../hooks/usePinSetupDone';
import { useBiometricSetupDone } from '../hooks/useBiometricSetupDone';
import { markPinVerifiedThisInstall, usePinVerifiedThisInstall } from '../hooks/usePinVerifiedThisInstall';
import { useAppLock } from '../hooks/useAppLock';
import { clearSignInFlags } from '../services/signInFlags';
import { hasDeviceCredential } from '../services/device.service';
import { labelTrustedDevice, registerTrustedDevice, signOut } from '../services/auth.service';
import { View, StyleSheet, ActivityIndicator, Linking, BackHandler } from 'react-native';
import { parsePaymentLink, type PaymentLink } from '../services/paymentLink.service';
import { colors } from '../theme';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import { Springs } from '../constants/springs';
import { HomeTabIcon, PayTabIcon, HistoryTabIcon, ProfileTabIcon } from '../components/icons/TabIcons';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import AppLockScreen from '../screens/auth/AppLockScreen';
import PinLoginScreen from '../screens/auth/PinLoginScreen';
import SetupPinScreen from '../screens/auth/SetupPinScreen';
import BiometricSetupScreen from '../screens/auth/BiometricSetupScreen';
import WelcomeBackScreen from '../screens/auth/WelcomeBackScreen';
import DeletionPendingScreen from '../screens/auth/DeletionPendingScreen';
import NoAccountScreen from '../screens/auth/NoAccountScreen';
import { useDeletionPending } from '../hooks/useDeletionPending';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

// ─── Param list types ────────────────────────────────────────

// 'login' prefers PIN-only sign-in when this device is trusted; 'login-sms' is
// the same intent after the user has explicitly asked for a code instead.
export type AuthIntent = 'signup' | 'login' | 'login-sms';

type AuthStackParamList = {
  Login: undefined;
  OTP: {
    phoneNumber: string;
    confirmation: FirebaseAuthTypes.ConfirmationResult;
  };
};

type MainStackParamList = {
  /** `screen` targets a tab, e.g. a payment link opening Payments pre-filled. */
  MainTabs: { screen: string; params?: object } | undefined;
  ScanQR: undefined;
  PaymentConfirm: {
    qrCodeId: string;
    amount: number;
    currency: string;
    merchantId?: string;
  };
  PaymentSuccess: {
    transactionId: string;
    amount: number;
    currency: string;
    merchantId?: string;
  };
  ManualTopup: undefined;
  TopUpMethod: undefined;
  AgentTopup: undefined;
  AgentLocator: undefined;
  CashOut: undefined;
  Notifications: undefined;
  TransactionDetail: { transaction: any };
  // Exactly one of transactionId or agentTopupRequestId (cash handed to an
  // agent for a top-up that was never credited).
  RaiseDispute: { transactionId?: string; agentTopupRequestId?: string };
  Disputes: undefined;
  DisputeDetail: { disputeId: string; justOpened?: boolean };
  Security: undefined;
  Devices: undefined;
  ChangePhone: undefined;
  MyQR: undefined;
  // Exactly one of requestId (a shop's in-person charge) or chargeId (a
  // charge raised through the Zapp API: online checkout or a till).
  ApprovePayment: {
    requestId?: string;
    chargeId?: string;
    merchantName?: string;
    amount?: number;
    currency?: string;
    createdAt?: string;
    reference?: string;
  };
  // `MobileMoney` and `SendRemittance` are intentionally unregistered: both
  // screens call callables that were deleted from prod on 2026-09-18 because
  // the Zaad/eDahab and Stripe stubs turned fake success into real balance.
  // The screens stay in the repo for when real rails exist; until then there
  // must be no route that reaches them.
  MerchantOnboarding: undefined;
  MerchantQR: undefined;
  MerchantScan: undefined;
  EnterAmount: {
    merchantId: string;
    merchantName: string;
    currency: string;
  };
  EditProfile: undefined;
  KYC: undefined;
  LinkedAccounts: undefined;
  TransactionLimits: undefined;
  About: undefined;
  Invite: undefined;
  Insights: undefined;
};

// ─── Navigators ──────────────────────────────────────────────

const RootStack = createStackNavigator();
const AuthStack = createStackNavigator<AuthStackParamList>();
const MainStack = createStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator();

// ─── Tab icon ────────────────────────────────────────────────

// ─── Auth navigator (Login + OTP only) ──────────────────────

function AuthStackNavigator({
  intent,
  onExit,
}: {
  intent: AuthIntent;
  onExit: () => void;
}) {
  // Rendered as a child function rather than via getComponent so the welcome
  // screen's choice (sign up vs log in) can reach LoginScreen. Memoised so the
  // navigator doesn't remount the screen on every parent render.
  const renderLogin = useCallback(
    (props: any) => {
      const LoginScreen = require('../screens/auth/LoginScreen').default;
      return <LoginScreen {...props} intent={intent} onBack={onExit} />;
    },
    [intent, onExit],
  );

  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login">{renderLogin}</AuthStack.Screen>
      <AuthStack.Screen
        name="OTP"
        getComponent={() => require('../screens/auth/OTPScreen').default}
      />
    </AuthStack.Navigator>
  );
}

// ─── Main tabs ──────────────────────────────────────────────

function MainTabs() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.action.primary,
        tabBarInactiveTintColor: '#9A9AA0',
        headerStyle: { backgroundColor: colors.background.primary },
        headerTitleStyle: { fontWeight: '700', color: colors.text.primary },
        headerTintColor: colors.text.primary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: -0.1,
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingTop: 6,
        },
        tabBarStyle: {
          backgroundColor: colors.background.primary,
          borderTopColor: colors.border.light,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 88,
          paddingBottom: 28,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        getComponent={() => require('../screens/wallet/DashboardScreen').default}
        options={{
          title: t('nav.tab.home'),
          headerShown: false,
          tabBarIcon: ({ focused, color, size }) => <HomeTabIcon focused={focused} color={color} size={size} />,
          tabBarAccessibilityLabel: t('nav.tab.homeAccessibility'),
        }}
      />
      <Tab.Screen
        name="Payments"
        getComponent={() => require('../screens/payments/PaymentsScreen').default}
        options={{
          title: t('nav.tab.payments'),
          tabBarIcon: ({ focused, color, size }) => <PayTabIcon focused={focused} color={color} size={size} />,
          tabBarAccessibilityLabel: t('nav.tab.paymentsAccessibility'),
        }}
      />
      <Tab.Screen
        name="History"
        getComponent={() => require('../screens/wallet/TransactionHistoryScreen').default}
        options={{
          title: t('nav.tab.history'),
          tabBarIcon: ({ focused, color, size }) => <HistoryTabIcon focused={focused} color={color} size={size} />,
          tabBarAccessibilityLabel: t('nav.tab.historyAccessibility'),
        }}
      />
      <Tab.Screen
        name="Profile"
        getComponent={() => require('../screens/profile/ProfileScreen').default}
        options={{
          title: t('nav.tab.profile'),
          tabBarIcon: ({ focused, color, size }) => <ProfileTabIcon focused={focused} color={color} size={size} />,
          tabBarAccessibilityLabel: t('nav.tab.profileAccessibility'),
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Main stack (tabs + detail screens) ─────────────────────

function MainStackNavigator() {
  const { t } = useTranslation();

  return (
    <MainStack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: colors.dark.canvas },
        headerStyle: { backgroundColor: colors.dark.canvas },
        headerTitleStyle: { fontWeight: '700', color: colors.dark.text },
        headerTintColor: colors.dark.text,
        transitionSpec: {
          open:  { animation: 'spring', config: { ...Springs.transition, mass: 1, overshootClamping: false, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01 } },
          close: { animation: 'spring', config: { ...Springs.transition, mass: 1, overshootClamping: false, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01 } },
        },
        cardStyleInterpolator: ({ current, next, layouts }) => ({
          cardStyle: {
            transform: [
              {
                translateX: current.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [layouts.screen.width * 0.08, 0],
                }),
              },
            ],
            opacity: current.progress.interpolate({
              inputRange: [0, 0.4, 1],
              outputRange: [0, 0.8, 1],
            }),
          },
          overlayStyle: {
            opacity: next
              ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07] })
              : undefined,
          },
        }),
      }}
    >
      <MainStack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ScanQR"
        getComponent={() => require('../screens/qr/ScanQRScreen').default}
        options={{ title: t('nav.screen.scanQr'), presentation: 'modal' }}
      />
      <MainStack.Screen
        name="PaymentConfirm"
        getComponent={() => require('../screens/qr/PaymentConfirmScreen').default}
        options={{ title: t('nav.screen.confirmPayment'), presentation: 'modal' }}
      />
      <MainStack.Screen
        name="PaymentSuccess"
        getComponent={() => require('../screens/qr/PaymentSuccessScreen').default}
        options={{ title: t('nav.screen.paymentSuccessful'), headerShown: false }}
      />
      <MainStack.Screen
        name="ManualTopup"
        getComponent={() => require('../screens/topup/ManualTopupScreen').default}
        options={{ title: t('nav.screen.topUp') }}
      />
      <MainStack.Screen
        name="TopUpMethod"
        getComponent={() => require('../screens/topup/TopUpMethodScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="AgentTopup"
        getComponent={() => require('../screens/topup/AgentTopupScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="AgentLocator"
        getComponent={() => require('../screens/agent/AgentLocatorScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="CashOut"
        getComponent={() => require('../screens/agent/CashOutScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Notifications"
        getComponent={() => require('../screens/notifications/NotificationsScreen').default}
        options={{ title: t('nav.screen.notifications') }}
      />
      <MainStack.Screen
        name="TransactionDetail"
        getComponent={() => require('../screens/wallet/TransactionDetailScreen').default}
        options={{ title: t('nav.screen.transactionDetails') }}
      />
      <MainStack.Screen
        name="RaiseDispute"
        getComponent={() => require('../screens/disputes/RaiseDisputeScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Disputes"
        getComponent={() => require('../screens/disputes/DisputesScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="DisputeDetail"
        getComponent={() => require('../screens/disputes/DisputeDetailScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Security"
        getComponent={() => require('../screens/profile/SecurityScreen').default}
        options={{ title: t('nav.screen.security') }}
      />
      <MainStack.Screen
        name="ChangePhone"
        getComponent={() => require('../screens/profile/ChangePhoneScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Devices"
        getComponent={() => require('../screens/profile/DevicesScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="MyQR"
        getComponent={() => require('../screens/payments/MyQRScreen').default}
        options={{ title: t('nav.screen.myQrCode') }}
      />
      <MainStack.Screen
        name="ApprovePayment"
        getComponent={() => require('../screens/payments/ApprovePaymentScreen').default}
        options={{ title: t('nav.screen.paymentRequest'), presentation: 'modal' }}
      />
      <MainStack.Screen
        name="MerchantOnboarding"
        getComponent={() => require('../screens/merchant/MerchantOnboardingScreen').default}
        options={{ title: t('nav.screen.becomeMerchant') }}
      />
      <MainStack.Screen
        name="MerchantQR"
        getComponent={() => require('../screens/merchant/MerchantQRScreen').default}
        options={{ title: t('nav.screen.myPaymentQr'), headerShown: false }}
      />
      <MainStack.Screen
        name="MerchantScan"
        getComponent={() => require('../screens/merchant/MerchantScanScreen').default}
        options={{ title: t('nav.screen.chargeCustomer'), headerShown: false, presentation: 'modal' }}
      />
      <MainStack.Screen
        name="EnterAmount"
        getComponent={() => require('../screens/qr/EnterAmountScreen').default}
        options={{ title: t('nav.screen.payMerchant'), headerShown: false }}
      />
      <MainStack.Screen
        name="EditProfile"
        getComponent={() => require('../screens/profile/EditProfileScreen').default}
        options={{ title: t('nav.screen.editProfile') }}
      />
      <MainStack.Screen
        name="KYC"
        getComponent={() => require('../screens/profile/KYCScreen').default}
        options={{ title: t('nav.screen.identityVerification') }}
      />
      <MainStack.Screen
        name="LinkedAccounts"
        getComponent={() => require('../screens/profile/LinkedAccountsScreen').default}
        options={{ title: t('nav.screen.linkedAccounts') }}
      />
      <MainStack.Screen
        name="TransactionLimits"
        getComponent={() => require('../screens/profile/TransactionLimitsScreen').default}
        options={{ title: t('nav.screen.transactionLimits') }}
      />
      <MainStack.Screen
        name="About"
        getComponent={() => require('../screens/profile/AboutScreen').default}
        options={{ title: t('nav.screen.about') }}
      />
      <MainStack.Screen
        name="Invite"
        getComponent={() => require('../screens/referral/InviteScreen').default}
        options={{ title: t('invite.title') }}
      />
      <MainStack.Screen
        name="Insights"
        getComponent={() => require('../screens/insights/InsightsScreen').default}
        options={{ title: t('dashboard.insights') }}
      />
    </MainStack.Navigator>
  );
}

// ─── Root navigator ─────────────────────────────────────────

function BootstrapLoading() {
  return (
    <View style={styles.bootstrapLoading}>
      <ActivityIndicator size="large" color={colors.action.primary} />
    </View>
  );
}

export default function AppNavigator() {
  const { user, loading: authLoading } = useAuth();
  useIdleSignOut(!!user);
  useDeviceIntegrity(!!user);
  const pinSetupDone = usePinSetupDone(user?.uid);
  const biometricSetupDone = useBiometricSetupDone();
  const pinVerified = usePinVerifiedThisInstall();
  const { locked, unlock } = useAppLock();
  const deletionDueAt = useDeletionPending(user?.uid);

  // A zapppay://send link waits here until the app is signed in: every gate
  // below renders outside the NavigationContainer, so the container only
  // mounts — and reports ready — once there is nothing left to bypass. The
  // app lock covers the container rather than replacing it, so the link's
  // screen can open underneath and is there once the app is unlocked.
  const [pendingLink, setPendingLink] = useState<PaymentLink | null>(null);
  const [navReadyTick, setNavReadyTick] = useState(0);

  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => {
        const link = parsePaymentLink(url);
        if (link) setPendingLink(link);
      })
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => {
      const link = parsePaymentLink(url);
      if (link) setPendingLink(link);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!pendingLink || !user || !navigationRef.isReady()) return;
    navigationRef.navigate('MainTabs', {
      screen: 'Payments',
      // A fresh object per link, so a second link re-triggers the pre-fill.
      params: { mode: 'send', prefill: { ...pendingLink } },
    });
    setPendingLink(null);
  }, [pendingLink, user, navReadyTick]);

  // The welcome screen is the logged-out home, not a one-time tour: this is
  // session state, so signing out lands you back on it with both entry points
  // available. Null means "hasn't chosen yet".
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null);

  // Only fires when `user` actually flips (or auth first settles), so it clears
  // the intent on sign-out without wiping it while the user is mid-way through
  // the auth stack (where `user` is still null).
  useEffect(() => {
    if (authLoading || user) return;
    setAuthIntent(null);
    // The gates' flags belong to one sign-in. signOut clears them on the way
    // out, but Firebase also ends sessions by itself (the server revokes them
    // after a PIN reset, a removed phone or a freeze), and flags left over
    // from that let the next SMS sign-in skip the PIN.
    clearSignInFlags();
    // Signing in again (PIN or SMS) already proves who this is; a lock left
    // over from the session that just ended would ask a second time.
    unlock();
  }, [authLoading, user, unlock]);

  const clearAuthIntent = useCallback(() => setAuthIntent(null), []);

  // Whether this device holds a trusted-device credential, which is what makes
  // PIN-only sign-in possible. Re-checked whenever auth flips, since a fresh
  // sign-in mints one.
  const [deviceTrusted, setDeviceTrusted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasDeviceCredential()
      .then((trusted) => !cancelled && setDeviceTrusted(trusted))
      .catch(() => !cancelled && setDeviceTrusted(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Trust this device once the account is fully authenticated with a confirmed
  // PIN, so the next sign-in here can skip SMS. Idempotent and never throws.
  useEffect(() => {
    if (user && pinSetupDone === true && pinVerified === true) {
      registerTrustedDevice()
        .then(() => setDeviceTrusted(true))
        .catch(() => {});
      // Phones trusted before the PIN sign-in screen named the account.
      labelTrustedDevice();
    }
  }, [user, pinSetupDone, pinVerified]);

  // Memoised: React Navigation keys a screen's component off the identity of
  // its render function, so an inline arrow here would remount the whole auth
  // stack — and discard a half-typed phone number — on any parent re-render.
  const renderAuthStack = useCallback(
    () => (
      <AuthStackNavigator
        intent={authIntent === 'signup' ? 'signup' : 'login'}
        onExit={clearAuthIntent}
      />
    ),
    [authIntent, clearAuthIntent],
  );

  const isLoading =
    authLoading ||
    // Only blocks the PIN-vs-SMS decision, never the welcome screen itself.
    (!user && authIntent === 'login' && deviceTrusted === null) ||
    (user != null &&
      (deletionDueAt === undefined ||
        pinSetupDone === null ||
        biometricSetupDone === null ||
        pinVerified === null ||
        locked === null));

  // Each sign-in screen sets its flag when it's done (services/signInFlags),
  // and the first gate whose flag isn't set yet shows.
  //
  // Gate screens render outside NavigationContainer. Swapping root stack
  // screens during bootstrap was crashing react-native-screens on iOS.
  const renderGate = () => {
    if (isLoading) {
      return <BootstrapLoading />;
    }

    if (!user && authIntent === null) {
      return (
        <OnboardingScreen
          onGetStarted={() => setAuthIntent('signup')}
          onLogin={() => setAuthIntent('login')}
        />
      );
    }

    // Returning user on a device that has already verified by SMS: the PIN alone
    // signs them back in. "Use a code instead" drops to the phone + OTP flow.
    if (!user && authIntent === 'login' && deviceTrusted === true) {
      return (
        <PinLoginScreen
          onUseCode={() => setAuthIntent('login-sms')}
          onBack={clearAuthIntent}
        />
      );
    }

    // Signed back in while the account waits to be deleted: keep it (PIN) or leave.
    if (user && deletionDueAt) {
      return (
        <DeletionPendingScreen
          dueAt={deletionDueAt}
          onKept={() => {
            // The PIN was just checked on the server.
            markPinVerifiedThisInstall();
            unlock();
          }}
        />
      );
    }

    // Chose Log in, but the verified number has no account: say so rather than
    // quietly start a sign-up. Creating one carries on to the PIN screen.
    if (user && pinSetupDone === false && (authIntent === 'login' || authIntent === 'login-sms')) {
      return (
        <NoAccountScreen
          phone={user.phoneNumber}
          onCreate={() => setAuthIntent('signup')}
          onOtherNumber={() => signOut().catch(() => undefined)}
        />
      );
    }

    if (user && pinSetupDone === false) {
      return <SetupPinScreen />;
    }

    // Returning user (PIN exists on the server, e.g. new device / reinstall /
    // post-sign-out login) who hasn't proven their PIN on this install yet.
    if (user && pinVerified === false) {
      return <WelcomeBackScreen />;
    }

    if (user && biometricSetupDone === false) {
      return <BiometricSetupScreen />;
    }

    const app = (
      <NavigationContainer ref={navigationRef} onReady={() => setNavReadyTick((n) => n + 1)}>
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          {user ? (
            <RootStack.Screen name="Main" component={MainStackNavigator} />
          ) : (
            <RootStack.Screen name="Auth">{renderAuthStack}</RootStack.Screen>
          )}
        </RootStack.Navigator>
      </NavigationContainer>
    );
    // Terms and privacy, recorded with versions (review E12).
    return user ? <ConsentGate uid={user.uid}>{app}</ConsentGate> : app;
  };

  // The lock covers what's underneath instead of replacing it, as in the
  // merchant app. Replacing it tore down every screen at each lock, so each
  // unlock rebuilt the app on the home tab and reloaded the wallet, and
  // nothing loaded while Face ID ran. It goes up as soon as the phone knows
  // it's locked, without waiting on the server reads below it. A pending
  // deletion has its own PIN screen and stays uncovered.
  const showLock = user != null && locked === true && !deletionDueAt;

  // Android's back button would otherwise go back in the app hidden under
  // the lock. Registered after the navigator's handler, so it's asked first.
  useEffect(() => {
    if (!showLock) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [showLock]);

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        accessibilityElementsHidden={showLock}
        importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}
      >
        {renderGate()}
      </View>
      {showLock ? (
        <View style={[StyleSheet.absoluteFill, styles.lockCover]}>
          {/* It marks the PIN checked itself as it unlocks. */}
          <AppLockScreen onUnlock={unlock} />
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  bootstrapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  lockCover: {
    backgroundColor: colors.dark.canvas,
  },
});
