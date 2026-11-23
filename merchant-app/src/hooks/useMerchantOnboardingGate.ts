import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import i18n from '../i18n';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './useAuth';
import { logger } from '../utils/logger';
import { userHasPin } from '../utils/pinHash';
import { watchMyGrants, type StaffGrant } from '../services/staff.service';

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
 * - `application` — picked a role; now filling in the full application.
 * - `pending`    — applied, waiting on an admin. Privileged roles are granted
 *                  by review, not self-selected (ADMIN_CONSOLE_PLAN.md §4.1).
 * - `rejected`   — the application was declined; the reason is shown.
 * - `agentProfile` — approved agent who has not yet given area/hours. This
 *   step used to run during onboarding, before approval existed.
 * - `staff`      — a person (customer account) a shop has invited or added
 *                  as staff (STAFF_ACCESS.md): staff mode, never the shop's app.
 * - `ready`      — into the app.
 */
export type MerchantGateState =
  | 'onboarding'
  | 'application'
  | 'pending'
  | 'rejected'
  | 'agentProfile'
  | 'staff'
  | 'ready';

export interface MerchantOnboardingGate {
  loading: boolean;
  /** Retained for callers that only care whether the main app can mount. */
  needsOnboarding: boolean;
  state: MerchantGateState;
  requestedRole?: MerchantRole;
  rejectionReason?: string;
  /** Already KYC-verified: the application skips the ID step. */
  kycVerified: boolean;
  /** Shops this person works for or is invited to (staff mode). */
  staffGrants: StaffGrant[];
}

export function useMerchantOnboardingGate(): MerchantOnboardingGate {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [requestedRole, setRequestedRole] = useState<MerchantRole | undefined>();
  const [rejectionReason, setRejectionReason] = useState<string | undefined>();
  const [kycVerified, setKycVerified] = useState(false);
  const [userState, setUserState] = useState<MerchantGateState>('onboarding');
  const [isShopAccount, setIsShopAccount] = useState(false);
  const [hasPinSet, setHasPinSet] = useState(false);
  const [staffGrants, setStaffGrants] = useState<StaffGrant[]>([]);
  const [grantsLoaded, setGrantsLoaded] = useState(false);

  // Invitations and grants from shops. Only a person's own grants are readable.
  useEffect(() => {
    setStaffGrants([]);
    setGrantsLoaded(false);
    if (authLoading || !user?.uid) return;
    return watchMyGrants(
      user.uid,
      (grants) => {
        setStaffGrants(grants);
        setGrantsLoaded(true);
      },
      (err) => {
        logger.error('useMerchantOnboardingGate staff:', err);
        setStaffGrants([]);
        setGrantsLoaded(true);
      },
      // Staff mode closes the moment a shop removes someone: say why, rather
      // than drop them on the sign-up screen with no word.
      (grant) =>
        Alert.alert(
          i18n.t('staff.removed.title'),
          i18n.t(grant.status === 'invited' ? 'staff.removed.inviteMessage' : 'staff.removed.message', {
            shop: grant.shopName,
          })
        )
    );
  }, [user?.uid, authLoading]);


  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user?.uid) {
      setLoading(false);
      setUserState('onboarding');
      return;
    }

    setLoading(true);
    const ref = firestore().collection('users').doc(user.uid);
    const unsub = ref.onSnapshot(
      (docSnap) => {
        const data = docSnap.data();
        const hasPin = userHasPin(data);
        const accountType = data?.accountType;
        const roleRequestStatus = data?.roleRequestStatus;
        setHasPinSet(hasPin);
        setIsShopAccount(isMerchantAccountType(accountType));

        setRequestedRole(
          isMerchantAccountType(data?.roleRequestedRole)
            ? data?.roleRequestedRole
            : undefined
        );
        setRejectionReason(
          typeof data?.roleRequestReason === 'string' ? data.roleRequestReason : undefined
        );
        setKycVerified(data?.kycStatus === 'verified');

        if (!hasPin) {
          setUserState('onboarding');
        } else if (isMerchantAccountType(accountType)) {
          // Agents owe us area/opening hours, a step that used to run during
          // onboarding. Only ask accounts that came through review: agents who
          // predate the approval gate keep working exactly as before rather
          // than being stopped at a form they already skipped.
          const owesAgentProfile =
            roleRequestStatus === 'approved' &&
            isAgentAccountType(accountType) &&
            !data?.agentInfo;
          setUserState(owesAgentProfile ? 'agentProfile' : 'ready');
        } else if (roleRequestStatus === 'pending') {
          // Applied, but the full application (business, payout, ID) isn't
          // in yet: the reviewer can't decide without it.
          setUserState(data?.roleApplicationSubmittedAt ? 'pending' : 'application');
        } else if (roleRequestStatus === 'rejected') {
          setUserState('rejected');
        } else {
          setUserState('onboarding');
        }

        setLoading(false);
      },
      (err) => {
        logger.error('useMerchantOnboardingGate:', err);
        setLoading(false);
        setUserState('onboarding');
      }
    );

    return unsub;
  }, [user?.uid, authLoading]);

  // A shop's own account never enters staff mode; a person with a PIN and at
  // least one invite or grant does.
  const state: MerchantGateState =
    hasPinSet && !isShopAccount && staffGrants.length > 0 ? 'staff' : userState;

  return {
    loading: authLoading || loading || (!!user && !grantsLoaded),
    needsOnboarding: !!user && state !== 'ready',
    state,
    requestedRole,
    rejectionReason,
    kycVerified,
    staffGrants,
  };
}
