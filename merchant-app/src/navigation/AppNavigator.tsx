import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useMerchantOnboardingGate } from '../hooks/useMerchantOnboardingGate';
import MerchantOnboardingNavigator from './MerchantOnboardingNavigator';
import RoleReviewPendingScreen from '../screens/auth/RoleReviewPendingScreen';
import { confirmSignOut } from '../utils/confirmSignOut';
import { AppLockGate } from '../components/security/AppLockGate';
import { DeletionPendingScreen } from '../components/security/DeletionPendingScreen';
import { useDeletionPending } from '../hooks/useDeletionPending';
import { useIdleSignOut } from '../hooks/useIdleSignOut';
import { useDeviceIntegrity } from '../hooks/useDeviceIntegrity';
import { ConsentGate } from '../components/legal/ConsentGate';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import {
  HomeTabIcon,
  ScanTabIcon,
  ReceiveTabIcon,
  HistoryTabIcon,
  SettingsTabIcon,
} from '../components/icons/TabIcons';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

export const navigationRef = createNavigationContainerRef<MerchantStackParamList>();

type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  OTP: {
    phoneNumber: string;
    confirmation: FirebaseAuthTypes.ConfirmationResult;
  };
};

type MerchantStackParamList = {
  MainTabs: undefined;
  Charge: {
    tokenId: string;
    customerName: string;
    customerId: string;
    /** "cash_out": the agent hands over cash once the customer approves. */
    purpose?: 'payment' | 'cash_out';
  };
  ScanCashOut: { purpose: 'cash_out' };
  TransactionDetail: { transaction: any };
  TopupCustomer: undefined;
  TopupHistory: undefined;
  ConfirmCashOut: undefined;
  ConfirmTopup: undefined;
  AgentProfileEdit: undefined;
  Payroll: undefined;
  Payout: undefined;
  Developers: undefined;
  DeleteAccount: undefined;
  DisputesInbox: undefined;
  DisputeDetail: { disputeId: string };
  ReportProblem: { transactionId: string };
  AutoPayout: undefined;
  Statement: undefined;
  MoveToFloat: undefined;
  Security: undefined;
  Devices: undefined;
  ChangePhone: undefined;
  ChangePin: undefined;
  ResetPin: undefined;
};

type TabParamList = {
  Dashboard: undefined;
  ScanCharge: undefined;
  GenerateQR: undefined;
  History: undefined;
  Settings: undefined;
};

const RootStack = createStackNavigator();
const AuthStack = createStackNavigator<AuthStackParamList>();
const MainStack = createStackNavigator<MerchantStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

type TabIconArgs = { color: string; focused: boolean };

const DashboardIcon = ({ color, focused }: TabIconArgs) => <HomeTabIcon color={color} focused={focused} />;
const ScanIcon = ({ color, focused }: TabIconArgs) => <ScanTabIcon color={color} focused={focused} />;
const HistoryIcon = ({ color, focused }: TabIconArgs) => <HistoryTabIcon color={color} focused={focused} />;
const SettingsIcon = ({ color, focused }: TabIconArgs) => <SettingsTabIcon color={color} focused={focused} />;
const ReceiveIcon = ({ color, focused }: TabIconArgs) => <ReceiveTabIcon color={color} focused={focused} />;

function BootstrapLoading() {
  return (
    <View style={styles.bootstrapLoading}>
      <ActivityIndicator size="large" color={colors.action.primary} />
    </View>
  );
}

function AuthStackNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen
        name="Welcome"
        getComponent={() => require('../screens/auth/WelcomeScreen').default}
      />
      <AuthStack.Screen
        name="Login"
        getComponent={() => require('../screens/auth/LoginScreen').default}
      />
      <AuthStack.Screen
        name="OTP"
        getComponent={() => require('../screens/auth/OTPScreen').default}
      />
    </AuthStack.Navigator>
  );
}

function MainTabs() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.action.primary,
        tabBarInactiveTintColor: '#9A9AA0',
        headerStyle: { backgroundColor: colors.background.primary },
        headerTitleStyle: { fontWeight: 'bold' },
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
        name="Dashboard"
        getComponent={() => require('../screens/dashboard/DashboardScreen').default}
        options={{
          title: t('navigation.tabs.home'),
          tabBarIcon: DashboardIcon,
          tabBarAccessibilityLabel: t('navigation.accessibility.dashboardTab'),
        }}
      />
      <Tab.Screen
        name="ScanCharge"
        getComponent={() => require('../screens/scan/ScanCustomerScreen').default}
        options={{
          title: t('navigation.tabs.scan'),
          headerTitle: t('navigation.tabs.scanAndCharge'),
          tabBarIcon: ScanIcon,
          tabBarAccessibilityLabel: t('navigation.accessibility.scanTab'),
        }}
      />
      <Tab.Screen
        name="GenerateQR"
        getComponent={() => require('../screens/qr/GenerateQRScreen').default}
        options={{
          title: t('navigation.tabs.receive'),
          headerTitle: t('navigation.tabs.receivePayment'),
          tabBarIcon: ReceiveIcon,
          tabBarAccessibilityLabel: t('navigation.accessibility.generateQRTab'),
        }}
      />
      <Tab.Screen
        name="History"
        getComponent={() => require('../screens/transactions/TransactionHistoryScreen').default}
        options={{
          title: t('navigation.tabs.history'),
          tabBarIcon: HistoryIcon,
          tabBarAccessibilityLabel: t('navigation.accessibility.historyTab'),
        }}
      />
      <Tab.Screen
        name="Settings"
        getComponent={() => require('../screens/settings/SettingsScreen').default}
        options={{
          title: t('navigation.tabs.settings'),
          tabBarIcon: SettingsIcon,
          tabBarAccessibilityLabel: t('navigation.accessibility.settingsTab'),
        }}
      />
    </Tab.Navigator>
  );
}

function MainStackNavigator() {
  const { t } = useTranslation();

  return (
    <MainStack.Navigator
      screenOptions={{
        cardStyle: { backgroundColor: '#000000' },
        headerStyle: { backgroundColor: '#000000', elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { fontWeight: '700', color: '#FFFFFF' },
        headerTintColor: '#FFFFFF',
        headerShadowVisible: false,
        // The label would be the previous route's title, and MainTabs has
        // none, so iOS showed the internal name "MainTabs" in every language.
        headerBackTitleVisible: false,
      }}
    >
      <MainStack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Charge"
        getComponent={() => require('../screens/scan/ChargeScreen').default}
        options={{
          title: t('navigation.headers.chargeCustomer'),
          presentation: 'modal',
        }}
      />
      <MainStack.Screen
        name="TransactionDetail"
        getComponent={() => require('../screens/transactions/TransactionDetailScreen').default}
        options={{ title: t('navigation.headers.transactionDetails') }}
      />
      <MainStack.Screen
        name="TopupCustomer"
        getComponent={() => require('../screens/topup/TopupCustomerScreen').default}
        options={{ title: t('navigation.headers.topUpCustomer') }}
      />
      <MainStack.Screen
        name="TopupHistory"
        getComponent={() => require('../screens/topup/TopupHistoryScreen').default}
        options={{ title: t('navigation.headers.topUpHistory') }}
      />
      <MainStack.Screen
        name="ScanCashOut"
        getComponent={() => require('../screens/scan/ScanCustomerScreen').default}
        initialParams={{ purpose: 'cash_out' }}
        options={{ title: t('scan.cashOut.scanTitle') }}
      />
      <MainStack.Screen
        name="ConfirmCashOut"
        getComponent={() => require('../screens/cashout/ConfirmCashOutScreen').default}
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <MainStack.Screen
        name="ConfirmTopup"
        getComponent={() => require('../screens/topup/ConfirmTopupScreen').default}
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <MainStack.Screen
        name="AgentProfileEdit"
        options={{ headerShown: false, presentation: 'modal' }}
      >
        {(props) => {
          const AgentProfileSetupScreen = require('../screens/auth/AgentProfileSetupScreen').default;
          return <AgentProfileSetupScreen {...props} isSettings />;
        }}
      </MainStack.Screen>
      <MainStack.Screen
        name="Payout"
        getComponent={() => require('../screens/payouts/PayoutScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Payroll"
        getComponent={() => require('../screens/payroll/PayrollScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Developers"
        getComponent={() => require('../screens/settings/DevelopersScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="DeleteAccount"
        getComponent={() => require('../screens/settings/DeleteAccountScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="DisputesInbox"
        getComponent={() => require('../screens/disputes/DisputesInboxScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="DisputeDetail"
        getComponent={() => require('../screens/disputes/DisputeDetailScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="MoveToFloat"
        getComponent={() => require('../screens/agent/MoveToFloatScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="AutoPayout"
        getComponent={() => require('../screens/payouts/AutoPayoutScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Statement"
        getComponent={() => require('../screens/payouts/StatementScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Security"
        getComponent={() => require('../screens/settings/SecurityScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ChangePhone"
        getComponent={() => require('../screens/settings/ChangePhoneScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="Devices"
        getComponent={() => require('../screens/settings/DevicesScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ChangePin"
        getComponent={() => require('../screens/settings/ChangePinScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ResetPin"
        getComponent={() => require('../screens/settings/ResetPinScreen').default}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="ReportProblem"
        getComponent={() => require('../screens/disputes/ReportProblemScreen').default}
        options={{ headerShown: false }}
      />
    </MainStack.Navigator>
  );
}

export default function AppNavigator() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { loading, state, requestedRole, rejectionReason } = useMerchantOnboardingGate();
  useIdleSignOut(!!user);
  useDeviceIntegrity(!!user);
  const deletionDueAt = useDeletionPending(user?.uid);

  // A rejected applicant who chooses to try again is sent back through
  // onboarding. Local because there is nothing to persist: submitting writes a
  // fresh pending request, and that is what the gate reacts to.
  const [reapplying, setReapplying] = React.useState(false);
  React.useEffect(() => {
    if (state !== 'rejected') {
      setReapplying(false);
    }
  }, [state]);

  // Avoid mounting NavigationContainer during bootstrap — swapping root stack
  // screens while auth/onboarding state resolves crashes react-native-screens on iOS.
  if (loading || (user && deletionDueAt === undefined)) {
    return <BootstrapLoading />;
  }

  // Signed back in while the account waits to be deleted: keep it (PIN) or leave.
  if (user && deletionDueAt) {
    return <DeletionPendingScreen dueAt={deletionDueAt} />;
  }

  if (user && (state === 'onboarding' || (state === 'rejected' && reapplying))) {
    return (
      <NavigationContainer>
        <MerchantOnboardingNavigator />
      </NavigationContainer>
    );
  }

  // Waiting on (or refused by) admin review. No navigator: the gate listens to
  // the user document, so an approval swaps this for the app by itself.
  if (user && (state === 'pending' || state === 'rejected')) {
    return (
      <RoleReviewPendingScreen
        variant={state}
        requestedRole={requestedRole}
        rejectionReason={rejectionReason}
        onApplyAgain={() => setReapplying(true)}
      />
    );
  }

  // Approved agent who still owes us area/opening hours. This ran during
  // onboarding before approval existed; setupAgentProfile requires the agent
  // role, so it can only run once the role has actually been granted.
  if (user && state === 'agentProfile') {
    const AgentProfileSetupScreen = require('../screens/auth/AgentProfileSetupScreen').default;
    return <AgentProfileSetupScreen navigation={{ goBack: () => confirmSignOut(t) }} />;
  }

  const app = (
    <NavigationContainer ref={navigationRef}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          animationEnabled: true,
        }}
      >
        {user ? (
          <RootStack.Screen name="Main" component={MainStackNavigator} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthStackNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );

  // Signed in and approved: the app lock covers it (review A3). Keyed by uid
  // so a different account never inherits an unlocked state.
  return user ? (
    <AppLockGate key={user.uid}>
      {/* Terms and privacy, recorded with versions (review E12). */}
      <ConsentGate uid={user.uid}>{app}</ConsentGate>
    </AppLockGate>
  ) : (
    app
  );
}

const styles = StyleSheet.create({
  bootstrapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
});
