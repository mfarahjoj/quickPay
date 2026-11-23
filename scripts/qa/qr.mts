#!/usr/bin/env node
/**
 * Local QA only (docs/LOCAL_QA.md): print what a QR code would hold, for the
 * "QA · Enter QR payload" button the scanners show in a debug build on the
 * emulators (a simulator has no camera).
 *
 *   node scripts/qa/qr.mts sticker          # the coffee house's printed till sticker
 *   node scripts/qa/qr.mts charge 650       # a fresh $6.50 charge from the coffee house
 *   node scripts/qa/qr.mts customer         # Amina's pay-me code, for the merchant app's scanner
 *
 * Then copy the line into the simulator: `xcrun simctl pbcopy booted` takes it
 * from stdin, e.g. `node scripts/qa/qr.mts sticker | xcrun simctl pbcopy booted`.
 */
import { assertEmulatorsUp, call, amina, cafe } from './emulator-client.mts';

const [kind, arg] = process.argv.slice(2);

async function main(): Promise<string> {
  await assertEmulatorsUp();
  switch (kind) {
    case 'sticker': {
      const res = await call<{ data: { qrData: string } }>(cafe.uid, 'generateMerchantSticker', {});
      return res.data.qrData;
    }
    case 'charge': {
      const cents = Number(arg ?? 650);
      if (!Number.isInteger(cents) || cents <= 0) throw new Error('charge takes an amount in cents, e.g. 650');
      const res = await call<{ data: { emvQrData: string } }>(cafe.uid, 'generateQRCode', {
        amount: cents,
        currency: 'USD',
        reference: `QA-${Date.now() % 100000}`,
      });
      return res.data.emvQrData;
    }
    case 'customer': {
      const res = await call<{ data: { tokenData: string } }>(amina.uid, 'generateCustomerToken', {});
      return res.data.tokenData;
    }
    default:
      throw new Error('Usage: node scripts/qa/qr.mts sticker | charge <cents> | customer');
  }
}

main()
  .then((payload) => console.log(payload))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
