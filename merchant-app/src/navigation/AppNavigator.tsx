import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useMerchantOnboardingGate } from '../hooks/useMerchantOnboardingGate';
import MerchantOnboardingNavigator from './MerchantOnboardingNavigator';
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
  };
  TransactionDetail: { transaction: any };
  TopupCustomer: undefined;
  TopupHistory: undefined;
  ConfirmCashOut: undefined;
  ConfirmTopup: undefined;
  AgentProfileEdit: undefined;
  Payroll: undefined;
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
        name="ConfirmCashOut"
        getComponent={() => require('../screens/cashout/ConfirmCashOutScreen').default}
        options={{ title: 'Confirm Cash Out', presentation: 'modal' }}
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
        name="Payroll"
        getComponent={() => require('../screens/payroll/PayrollScreen').default}
        options={{ headerShown: false }}
      />
    </MainStack.Navigator>
  );
}

export default function AppNavigator() {
  const { user } = useAuth();
  const { loading, needsOnboarding } = useMerchantOnboardingGate();

  // Avoid mounting NavigationContainer during bootstrap — swapping root stack
  // screens while auth/onboarding state resolves crashes react-native-screens on iOS.
  if (loading) {
    return <BootstrapLoading />;
  }

  if (user && needsOnboarding) {
    return (
      <NavigationContainer>
        <MerchantOnboardingNavigator />
      </NavigationContainer>
    );
  }

  return (
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
}

const styles = StyleSheet.create({
  bootstrapLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
});
