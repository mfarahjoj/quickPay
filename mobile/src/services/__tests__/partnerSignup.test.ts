const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));
jest.mock('../apiAgreement.service', () => ({ getMyPendingAgreements: jest.fn() }));

import { getMyPendingAgreements, type PendingAgreement } from '../apiAgreement.service';
import { loadPendingAgreements, rememberOffer, requestToOffer, takeOffer } from '../partnerSignup';

const mockedPending = getMyPendingAgreements as jest.MockedFunction<typeof getMyPendingAgreements>;

const request = (agreementId: string, signup: boolean): PendingAgreement => ({
  agreementId,
  merchantName: 'Ridy',
  status: 'pending',
  role: 'worker',
  deviceLabel: 'iPhone',
  maxChargeUsdCents: 2_000,
  dailyUsdCents: 6_000,
  expiresAt: null,
  approvedAt: null,
  signup,
});
const prefill = { fullName: 'Hodan Ali', zaadNumber: '+252634555666' };

describe('partner sign-up', () => {
  beforeEach(() => mockedPending.mockReset());

  it('offers the newest request left before sign-up, else the newest', () => {
    expect(requestToOffer(null)).toBeNull();
    expect(requestToOffer({ agreements: [], prefill })).toBeNull();
    expect(requestToOffer({ agreements: [request('agr_a', false), request('agr_b', true)], prefill })?.agreementId).toBe('agr_b');
    expect(requestToOffer({ agreements: [request('agr_a', false)], prefill })?.agreementId).toBe('agr_a');
  });

  it('asks once per sign-in, and again after a failed read', async () => {
    mockedPending.mockRejectedValueOnce(new Error('offline'));
    expect(await loadPendingAgreements('u1')).toBeNull();
    mockedPending.mockResolvedValue({ agreements: [request('agr_b', true)], prefill });
    expect((await loadPendingAgreements('u1'))?.prefill.fullName).toBe('Hodan Ali');
    await loadPendingAgreements('u1');
    expect(mockedPending).toHaveBeenCalledTimes(2);
    await loadPendingAgreements('u2');
    expect(mockedPending).toHaveBeenCalledTimes(3);
  });

  it('hands the remembered request out once, to that account only', async () => {
    await rememberOffer('u1', 'agr_b');
    expect(await takeOffer('u2')).toBeNull();
    expect(await takeOffer('u1')).toBe('agr_b');
    expect(await takeOffer('u1')).toBeNull();
  });
});
