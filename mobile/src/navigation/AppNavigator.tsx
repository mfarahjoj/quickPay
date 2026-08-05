import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';
import { usePinSetupDone } from '../hooks/usePinSetupDone';
import { useBiometricSetupDone } from '../hooks/useBiometricSetupDone';
import { usePinVerifiedThisInstall } from '../hooks/usePinVerifiedThisInstall';
import { useAppLock } from '../hooks/useAppLock';
import { hasDeviceCredential } from '../services/device.service';
import { registerTrustedDevice } from '../services/auth.service';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
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
  MainTabs: undefined;
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
  MobileMoney: undefined;
  TopUpMethod: undefined;
  AgentTopup: undefined;
  AgentLocator: undefined;
  CashOut: undefined;
  Notifications: undefined;
  TransactionDetail: { transaction: any };
  Security: undefined;
  MyQR: undefined;
  ApprovePayment: {
    requestId: string;
    merchantName: string;
    amount: number;
    currency: string;
    createdAt?: string;
    reference?: string;
  };
  SendRemittance: undefined;
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
        name="MobileMoney"
        getComponent={() => require('../screens/topup/MobileMoneyScreen').default}
        options={{ title: t('nav.screen.mobileMoney') }}
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
        name="Security"
        getComponent={() => require('../screens/profile/SecurityScreen').default}
        options={{ title: t('nav.screen.security') }}
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
        name="SendRemittance"
        getComponent={() => require('../screens/remittance/SendRemittanceScreen').default}
        options={{ title: t('nav.screen.sendRemittance') }}
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
  const { done: pinSetupDone, markDone: markPinSetupDone } = usePinSetupDone();
  const { done: biometricSetupDone, markDone: markBiometricSetupDone } = useBiometricSetupDone();
  const { done: pinVerified, refresh: refreshPinVerified, markDone: markPinVerified } =
    usePinVerifiedThisInstall();
  const { locked, unlock } = useAppLock();

  // The welcome screen is the logged-out home, not a one-time tour: this is
  // session state, so signing out lands you back on it with both entry points
  // available. Null means "hasn't chosen yet".
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null);

  // Only fires when `user` actually flips, so it clears the intent on sign-in
  // and sign-out without wiping it while the user is mid-way through the auth
  // stack (where `user` is still null).
  useEffect(() => {
    if (!user) setAuthIntent(null);
  }, [user]);

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
      (pinSetupDone === null || biometricSetupDone === null || pinVerified === null));

  // Gate screens render outside NavigationContainer. Swapping root stack
  // screens during bootstrap was crashing react-native-screens on iOS.
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

  if (user && locked) {
    return (
      <AppLockScreen
        onUnlock={() => {
          // Unlocking proves the PIN (or Face ID backed by it) on this install.
          // Both updates are synchronous so the gate settles in one render.
          markPinVerified();
          unlock();
        }}
      />
    );
  }

  if (user && pinSetupDone === false) {
    return (
      <SetupPinScreen
        onComplete={({ verified }) => {
          // Set both flags synchronously (one batched render) so we never flash
          // the welcome-back screen between two async refreshes.
          markPinSetupDone();
          if (verified) markPinVerified();
          else refreshPinVerified();
        }}
      />
    );
  }

  // Returning user (PIN exists on the server, e.g. new device / reinstall /
  // post-sign-out login) who hasn't proven their PIN on this install yet.
  if (user && pinVerified === false) {
    return (
      <WelcomeBackScreen
        onComplete={() => {
          // Synchronous so we go straight to the app without flashing the
          // biometric-setup screen.
          markPinVerified();
          markBiometricSetupDone();
        }}
      />
    );
  }

  if (user && biometricSetupDone === false) {
    return (
      <BiometricSetupScreen navigation={{} as any} onComplete={markBiometricSetupDone} />
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <RootStack.Screen name="Main" component={MainStackNavigator} />
        ) : (
          <RootStack.Screen name="Auth">{renderAuthStack}</RootStack.Screen>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  bootstrapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
});
