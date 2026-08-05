import { useState, useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';
import { hasStoredPinHash } from '../utils/pinHash';

type MerchantRole = 'merchant' | 'topup_agent' | 'agent_merchant';

function isMerchantAccountType(t: unknown): t is MerchantRole {
  return t === 'merchant' || t === 'topup_agent' || t === 'agent_merchant';
}

function isAgentAccountType(t: unknown): boolean {
  return t === 'topup_agent' || t === 'agent_merchant';
}

/**
 * Where a signed-in merchant user belongs right now.
 *
 * - `onboarding` — no PIN yet, or never applied for a role (also where a
 *   rejected applicant goes if they choose to re-apply).
 * - `pending`    — applied, waiting on an admin. Privileged roles are granted
 *                  by review, not self-selected (ADMIN_CONSOLE_PLAN.md §4.1).
 * - `rejected`   — the application was declined; the reason is shown.
 * - `agentProfile` — approved agent who has not yet given area/hours. This
 *   step used to run during onboarding, before approval existed.
 * - `ready`      — into the app.
 */
export type MerchantGateState =
  | 'onboarding'
  | 'pending'
  | 'rejected'
  | 'agentProfile'
  | 'ready';

export interface MerchantOnboardingGate {
  loading: boolean;
  /** Retained for callers that only care whether the main app can mount. */
  needsOnboarding: boolean;
  state: MerchantGateState;
  requestedRole?: MerchantRole;
  rejectionReason?: string;
}

export function useMerchantOnboardingGate(): MerchantOnboardingGate {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<MerchantGateState>('onboarding');
  const [requestedRole, setRequestedRole] = useState<MerchantRole | undefined>();
  const [rejectionReason, setRejectionReason] = useState<string | undefined>();

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user?.uid) {
      setLoading(false);
      setState('onboarding');
      return;
    }

    setLoading(true);
    const ref = firestore().collection('users').doc(user.uid);
    const unsub = ref.onSnapshot(
      (docSnap) => {
        const data = docSnap.data();
        const hasPin = hasStoredPinHash(data?.pinHash);
        const accountType = data?.accountType;
        const roleRequestStatus = data?.roleRequestStatus;

        setRequestedRole(
          isMerchantAccountType(data?.roleRequestedRole)
            ? data?.roleRequestedRole
            : undefined
        );
        setRejectionReason(
          typeof data?.roleRequestReason === 'string' ? data.roleRequestReason : undefined
        );

        if (!hasPin) {
          setState('onboarding');
        } else if (isMerchantAccountType(accountType)) {
          // Agents owe us area/opening hours, a step that used to run during
          // onboarding. Only ask accounts that came through review: agents who
          // predate the approval gate keep working exactly as before rather
          // than being stopped at a form they already skipped.
          const owesAgentProfile =
            roleRequestStatus === 'approved' &&
            isAgentAccountType(accountType) &&
            !data?.agentInfo;
          setState(owesAgentProfile ? 'agentProfile' : 'ready');
        } else if (roleRequestStatus === 'pending') {
          setState('pending');
        } else if (roleRequestStatus === 'rejected') {
          setState('rejected');
        } else {
          setState('onboarding');
        }

        setLoading(false);
      },
      (err) => {
        logger.error('useMerchantOnboardingGate:', err);
        setLoading(false);
        setState('onboarding');
      }
    );

    return unsub;
  }, [user?.uid, authLoading]);

  return {
    loading: authLoading || loading,
    needsOnboarding: !!user && state !== 'ready',
    state,
    requestedRole,
    rejectionReason,
  };
}
