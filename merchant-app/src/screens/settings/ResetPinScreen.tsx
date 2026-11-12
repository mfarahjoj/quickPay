import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ResetPinFlow } from '../../components/security/ResetPinFlow';

/** Forgot PIN, from Settings or Change PIN. */
export default function ResetPinScreen() {
  const navigation = useNavigation<any>();
  return <ResetPinFlow onDone={() => navigation.goBack()} onCancel={() => navigation.goBack()} />;
}
