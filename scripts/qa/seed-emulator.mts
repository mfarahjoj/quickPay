#!/usr/bin/env node
/**
 * Local QA only (docs/LOCAL_QA.md): fill the Firebase emulators with a small,
 * realistic world to click through.
 *
 *   node scripts/qa/seed-emulator.mts          # wipes the emulators, then seeds
 *
 * Needs Node 23.6+ (runs TypeScript directly) and scripts/qa/emulators.sh
 * running. It refuses to talk to anything but 127.0.0.1.
 *
 * Every cent is moved by the real callables (setupPin, the float desk,
 * manualTopup, processPayment, payMerchant, sendP2P, payBill...), served by the
 * Functions emulator, so it is posted through functions/src/ledger/ exactly as
 * in production (CLAUDE.md money invariants). Nothing writes a balance. The
 * script ends by checking the ledger sums to zero in each currency.
 *
 * Accounts (all PINs 739146, a test value for the emulators only):
 *   Amina Warsame          +252634000001  customer, USD + SLS
 *   Hodan Ali              +252634000002  customer
 *   Hargeisa Coffee House  +252634000003  merchant
 *   Daallo Cash Point      +252634000004  top-up agent with USD + SLS float
 *   qa-ops / qa-super      admins (custom claims), used only to approve
 */
import { randomUUID } from 'node:crypto';
import {
  PROJECT,
  HOST,
  PORTS,
  PIN,
  admin,
  db,
  amina,
  hodan,
  cafe,
  agent,
  PEOPLE,
  OPS,
  SUPER,
  http,
  assertEmulatorsUp,
  call,
  type Person,
} from './emulator-client.mts';

/** Empty the emulators so every run starts from the same place. */
async function wipe(): Promise<void> {
  await http('DELETE', `http://${HOST}:${PORTS.firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
  await http('DELETE', `http://${HOST}:${PORTS.auth}/emulator/v1/projects/${PROJECT}/accounts`);
}

let failures = 0;
async function step<T>(label: string, fn: () => Promise<T>, opts: { optional?: boolean } = {}): Promise<T | undefined> {
  try {
    const out = await fn();
    console.log(`  ✓ ${label}`);
    return out;
  } catch (err: any) {
    if (!opts.optional) throw new Error(`${label}: ${err.message}`);
    failures += 1;
    console.log(`  ✗ ${label} (skipped): ${err.message}`);
    return undefined;
  }
}

function dayFromToday(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await assertEmulatorsUp();
  console.log(`Seeding emulators for ${PROJECT} on ${HOST}`);
  await wipe();

  console.log('Accounts');
  for (const p of PEOPLE) {
    await step(`${p.name} (${p.phone})`, () => admin.auth().createUser({ uid: p.uid, phoneNumber: p.phone, displayName: p.name }));
  }
  for (const a of [OPS, SUPER]) {
    await step(`admin ${a.email} [${a.roles.join(', ')}]`, async () => {
      await admin.auth().createUser({ uid: a.uid, email: a.email, emailVerified: true });
      await admin.auth().setCustomUserClaims(a.uid, { admin: true, adminRoles: a.roles });
    });
  }
  for (const p of PEOPLE) {
    await step(`setupPin ${p.name} as ${p.accountType}`, () =>
      call(p.uid, 'setupPin', { pin: PIN, fullName: p.name, accountType: p.accountType }),
    );
  }

  console.log('Roles (bare requests from setupPin, approved by compliance)');
  const pending = await call<{ data: Array<{ requestId: string; userId: string; requestedRole: string }> }>(
    OPS.uid,
    'adminListRoleRequests',
    { status: 'pending' },
  );
  for (const r of pending.data ?? []) {
    await step(`approve ${r.requestedRole} for ${r.userId}`, () =>
      call(OPS.uid, 'adminReviewRoleRequest', {
        requestId: r.requestId,
        decision: 'approve',
        reason: 'Local QA seed account',
        idNumber: `QA${r.userId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`,
      }),
    );
  }

  await step(`${agent.name} sets up an agent profile in Jigjiga Yar (shows in Find Agent)`, () =>
    call(agent.uid, 'setupAgentProfile', {
      businessName: agent.name,
      area: 'Jigjiga Yar',
      openHours: '7am – 10pm',
      services: ['cash_in', 'cash_out'],
    }),
  );

  console.log('Agent float (float desk: ops requests, super approves)');
  for (const [currency, amountCents, label] of [
    ['USD', 100_000, '$1,000'],
    ['SLS', 4_000_000, 'SLS 4,000,000'],
  ] as const) {
    await step(`issue ${label} float to ${agent.name}`, async () => {
      const req = await call<{ data: { issuanceId: string } }>(OPS.uid, 'adminRequestFloat', {
        agentId: agent.uid,
        direction: 'issue',
        amountCents,
        currency,
        route: 'cash',
        externalReference: `QA-CASH-${currency}`,
        reason: 'Local QA opening float',
      });
      await call(SUPER.uid, 'adminApproveFloat', { issuanceId: req.data.issuanceId, reason: 'Local QA opening float' });
    });
  }

  console.log('Cash-in at the agent (manualTopup)');
  const topup = (who: Person, amount: number, currency: 'USD' | 'SLS') =>
    call(agent.uid, 'manualTopup', {
      userId: who.uid,
      amount,
      currency,
      agentPin: PIN,
      paymentMethod: 'cash',
      // Always sent: without one, manualTopup writes `reference: undefined`
      // and Firestore rejects the top-up (docs/LOCAL_QA.md, findings).
      reference: `QA-${Math.floor(Math.random() * 9000 + 1000)}`,
      idempotencyKey: randomUUID(),
    });
  await step(`${amina.name} +$95`, () => topup(amina, 95, 'USD'));
  await step(`${amina.name} +$60`, () => topup(amina, 60, 'USD'));
  await step(`${amina.name} +SLS 400,000`, () => topup(amina, 400_000, 'SLS'));
  await step(`${hodan.name} +$40`, () => topup(hodan, 40, 'USD'));

  // Amounts below are in the currency's smallest unit (cents, whole shillings),
  // except manualTopup above, which takes whole dollars.
  console.log('Spending');
  await step(`${amina.name} pays ${cafe.name} $4.50 by dynamic QR`, async () => {
    const qr = await call<{ data: { qrCodeId: string } }>(cafe.uid, 'generateQRCode', {
      amount: 450,
      currency: 'USD',
      reference: 'Table 4',
    });
    await call(amina.uid, 'processPayment', { qrCodeId: qr.data.qrCodeId, pin: PIN });
  });
  const shopPayment = await step(`${amina.name} pays ${cafe.name} $12 at the till (static QR)`, () =>
    call<{ data: { transactionId: string } }>(amina.uid, 'payMerchant', {
      merchantId: cafe.uid,
      amount: 1200,
      currency: 'USD',
      pin: PIN,
      idempotencyKey: randomUUID(),
    }),
  );
  await step(`${amina.name} sends ${hodan.name} $10`, () =>
    call(amina.uid, 'sendP2P', { recipientPhone: hodan.phone, amount: 1000, currency: 'USD', pin: PIN, note: 'Lunch' }),
  );
  await step(`${hodan.name} sends ${amina.name} $5`, () =>
    call(hodan.uid, 'sendP2P', { recipientPhone: amina.phone, amount: 500, currency: 'USD', pin: PIN, note: 'Taxi' }),
  );
  await step(
    `${amina.name} sends ${hodan.name} SLS 25,000`,
    () => call(amina.uid, 'sendP2P', { recipientPhone: hodan.phone, amount: 25_000, currency: 'SLS', pin: PIN, note: 'Shaah' }),
    { optional: true },
  );

  console.log('Bills');
  await step(`${cafe.name} bills ${amina.name} $25, due in 5 days`, () =>
    call(cafe.uid, 'createBill', {
      customerPhone: amina.phone,
      amount: 2500,
      currency: 'USD',
      description: 'Monthly coffee plan',
      reference: 'PLAN-11',
      dueDate: dayFromToday(5),
      repeat: 'none',
      idempotencyKey: randomUUID(),
    }),
  );
  await step(`${cafe.name} bills ${amina.name} $8, which she pays`, async () => {
    const res = await call<{ data: { bill: { billId?: string; id?: string } } }>(cafe.uid, 'createBill', {
      customerPhone: amina.phone,
      amount: 800,
      currency: 'USD',
      description: 'Pastry order',
      dueDate: dayFromToday(2),
      repeat: 'none',
      idempotencyKey: randomUUID(),
    });
    const billId = res.data.bill.billId ?? res.data.bill.id;
    if (!billId) throw new Error(`createBill returned no bill id: ${JSON.stringify(res.data)}`);
    await call(amina.uid, 'payBill', { billId, pin: PIN, expectedAmount: 800 });
  });

  console.log('Disputes');
  if (shopPayment?.data?.transactionId) {
    await step(`${amina.name} disputes $2 of the $12 payment`, () =>
      call(amina.uid, 'openDispute', {
        transactionId: shopPayment.data.transactionId,
        kind: 'wrong_amount',
        note: 'The menu said $10 but I was charged $12.',
        amountCents: 200,
      }),
    );
  }

  console.log('Merchant extras');
  await step(
    `${cafe.name} saves a Zaad payout account`,
    () => call(cafe.uid, 'setZaadAccount', { msisdn: '0634123456', name: 'Hargeisa Coffee House', pin: PIN }),
    { optional: true },
  );
  await step(
    `${cafe.name} asks for a $5 payout`,
    () => call(cafe.uid, 'requestPayout', { amountCents: 500, currency: 'USD', pin: PIN, note: 'Weekly takings' }),
    { optional: true },
  );

  await summary();
}

// ── Check and report ─────────────────────────────────────────────────────────
async function summary(): Promise<void> {
  console.log('\nBalances');
  for (const p of PEOPLE) {
    const w = (await db.collection('wallets').doc(p.uid).get()).data() ?? {};
    const usd = ((w.balance ?? 0) / 100).toFixed(2);
    const sls = (w.sls?.balance ?? 0).toLocaleString('en-US');
    console.log(`  ${p.name.padEnd(22)} $${usd.padStart(8)}   SLS ${sls}`);
  }
  for (const currency of ['USD', 'SLS']) {
    const key = currency === 'USD' ? `agent:${agent.uid}` : `agent:${agent.uid}@SLS`;
    const float = (await db.collection('ledger_balances').doc(key).get()).data()?.balance ?? 0;
    console.log(`  ${`${agent.name} float`.padEnd(22)} ${currency === 'USD' ? `$${(float / 100).toFixed(2)}` : `SLS ${float.toLocaleString('en-US')}`}`);
  }

  // Zero-sum: every journal line nets out, and the projections agree with it.
  const entries = await db.collection('journal_entries').get();
  const net: Record<string, number> = {};
  for (const doc of entries.docs) {
    const e = doc.data();
    for (const l of e.lines) net[e.currency] = (net[e.currency] ?? 0) + l.debit - l.credit;
  }
  const balances = await db.collection('ledger_balances').get();
  const wallets = await db.collection('wallets').get();
  const projected: Record<string, number> = { USD: 0, SLS: 0 };
  for (const b of balances.docs) projected[b.data().currency ?? 'USD'] += b.data().balance ?? 0;
  for (const w of wallets.docs) {
    projected.USD += w.data().balance ?? 0;
    projected.SLS += w.data().sls?.balance ?? 0;
  }
  const journalOk = Object.values(net).every((v) => v === 0);
  const projectionOk = projected.USD === 0 && projected.SLS === 0;
  console.log(
    `\nLedger: ${entries.size} journal entries; lines net ${JSON.stringify(net)}; ` +
      `balances + wallets sum ${JSON.stringify(projected)} → ${journalOk && projectionOk ? 'zero-sum ✓' : 'NOT ZERO ✗'}`,
  );
  if (!journalOk || !projectionOk) process.exitCode = 1;
  if (failures) console.log(`${failures} optional step(s) skipped; see ✗ above.`);
  console.log(`\nSign in with any number above; the SMS code is in the auth emulator:`);
  console.log(`  curl -s http://${HOST}:${PORTS.auth}/emulator/v1/projects/${PROJECT}/verificationCodes`);
  console.log(`PIN for every seeded account: ${PIN}`);
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
