import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { colors } from '../theme';

export type MerchantOnboardingParamList = {
  MerchantOnboardingEntry: undefined;
  MerchantBasics: { prefilledName?: string } | undefined;
  MerchantRoleSelect: { fullName: string; pin?: string };
  AgentProfileSetup: undefined;
};

const Stack = createStackNavigator<MerchantOnboardingParamList>();

export default function MerchantOnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.background.primary },
      }}
      initialRouteName="MerchantOnboardingEntry"
    >
      <Stack.Screen
        name="MerchantOnboardingEntry"
        getComponent={() => require('../screens/auth/MerchantOnboardingEntryScreen').default}
      />
      <Stack.Screen
        name="MerchantBasics"
        getComponent={() => require('../screens/auth/MerchantBasicsScreen').default}
      />
      <Stack.Screen
        name="MerchantRoleSelect"
        getComponent={() => require('../screens/auth/MerchantRoleSelectScreen').default}
      />
      <Stack.Screen
        name="AgentProfileSetup"
        getComponent={() => require('../screens/auth/AgentProfileSetupScreen').default}
      />
    </Stack.Navigator>
  );
}
