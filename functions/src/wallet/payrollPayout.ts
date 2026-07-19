import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "../auth/validatePin";
import { notifyPaymentReceived } from "../utils/notifications";
import { ApiResponse, Wallet, Transaction } from "../types";
import { prepareJournalEntry, userAccount } from "../ledger";

interface PayrollEmployee {
  phone: string;
  amount: number; // cents
  name?: string;
  note?: string;
}

interface PayrollPayoutRequest {
  employees: PayrollEmployee[];
  currency: string;
  pin: string;
  payrollLabel?: string; // e.g. "June 2026 Salaries"
}

interface PayrollResult {
  phone: string;
  name?: string;
  amount: number;
  status: "success" | "failed";
  reason?: string;
  transactionId?: string;
}

interface PayrollPayoutResponse {
  totalPaid: number;
  successCount: number;
  failedCount: number;
  results: PayrollResult[];
}

const MAX_EMPLOYEES = 200;

export const payrollPayout = https.onCall(
  { enforceAppCheck: true, timeoutSeconds: 120 },
  async (
    request: https.CallableRequest<PayrollPayoutRequest>
  ): Promise<ApiResponse<PayrollPayoutResponse>> => {
    requireAuth(request);
    const merchantId = request.auth!.uid;

    const { employees, currency, pin, payrollLabel } = request.data;

    if (!Array.isArray(employees) || employees.length === 0) {
      throw new https.HttpsError("invalid-argument", "employees list is required");
    }
    if (employees.length > MAX_EMPLOYEES) {
      throw new https.HttpsError(
        "invalid-argument",
        `Maximum ${MAX_EMPLOYEES} employees per payroll run`
      );
    }
    if (!["USD", "SLS"].includes(currency)) {
      throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    }
    if (!pin) {
      throw new https.HttpsError("invalid-argument", "PIN is required");
    }

    const db = admin.firestore();

    // Verify PIN
    const pinValid = await verifyUserPin(merchantId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Incorrect PIN");
    }

    // Verify merchant account type
    const merchantDoc = await db.collection("users").doc(merchantId).get();
    if (!merchantDoc.exists) {
      throw new https.HttpsError("not-found", "Merchant account not found");
    }
    const merchant = merchantDoc.data()!;
    const accountType = merchant.accountType;
    if (accountType !== "merchant" && accountType !== "agent_merchant") {
      throw new https.HttpsError("permission-denied", "Only merchants can run payroll");
    }

    // Validate all amounts
    for (const emp of employees) {
      if (!Number.isInteger(emp.amount) || emp.amount <= 0) {
        throw new https.HttpsError(
          "invalid-argument",
          `Invalid amount for ${emp.phone}: must be a positive integer in cents`
        );
      }
    }

    const totalAmount = employees.reduce((sum, e) => sum + e.amount, 0);

    // Check merchant balance covers the full payroll
    const merchantWalletRef = db.collection("wallets").doc(merchantId);
    const merchantWallet = (await merchantWalletRef.get()).data() as Wallet | undefined;
    if (!merchantWallet || merchantWallet.balance < totalAmount) {
      throw new https.HttpsError(
        "failed-precondition",
        "Insufficient balance for payroll"
      );
    }

    // Resolve all phone numbers to user IDs in parallel
    const phoneToUser: Map<string, { id: string; name: string }> = new Map();
    await Promise.all(
      employees.map(async (emp) => {
        try {
          const q = await db
            .collection("users")
            .where("phoneNumber", "==", emp.phone)
            .limit(1)
            .get();
          if (!q.empty) {
            const d = q.docs[0];
            phoneToUser.set(emp.phone, {
              id: d.id,
              name: d.data().fullName || emp.name || emp.phone,
            });
          }
        } catch {
          // Will be marked failed in results
        }
      })
    );

    const results: PayrollResult[] = [];
    let successCount = 0;
    let totalPaid = 0;

    // Process each employee in its own Firestore transaction to stay atomic per-employee.
    // If the merchant runs dry mid-payroll, remaining transfers fail gracefully.
    for (const emp of employees) {
      const resolved = phoneToUser.get(emp.phone);
      if (!resolved) {
        results.push({
          phone: emp.phone,
          name: emp.name,
          amount: emp.amount,
          status: "failed",
          reason: "No QuickPay account found for this number",
        });
        continue;
      }

      const { id: recipientId, name: recipientName } = resolved;
      const transactionId = db.collection("transactions").doc().id;

      try {
        await db.runTransaction(async (tx) => {
          const pending = await prepareJournalEntry(tx, {
            entryId: `payroll_${transactionId}`,
            type: "payroll",
            currency: currency as "USD" | "SLS",
            lines: [
              { account: userAccount(merchantId), debit: emp.amount, credit: 0 },
              { account: userAccount(recipientId), debit: 0, credit: emp.amount },
            ],
            refs: { transactionId },
            description: payrollLabel || "Payroll",
            postedBy: merchantId,
          });

          const now = admin.firestore.Timestamp.now();

          pending.write(tx);

          const txRecord: Transaction = {
            type: "payment",
            fromUserId: merchantId,
            toUserId: recipientId,
            participants: [merchantId, recipientId],
            amount: emp.amount,
            currency,
            status: "completed",
            description: payrollLabel
              ? `${payrollLabel} — ${merchant.fullName || "Merchant"}`
              : `Salary from ${merchant.fullName || "Merchant"}`,
            ...(emp.note ? { note: emp.note } : {}),
            journalEntryId: `payroll_${transactionId}`,
            createdAt: now,
            completedAt: now,
          };

          tx.set(db.collection("transactions").doc(transactionId), txRecord);
        });

        results.push({ phone: emp.phone, name: recipientName, amount: emp.amount, status: "success", transactionId });
        successCount++;
        totalPaid += emp.amount;

        // Fire-and-forget FCM
        notifyPaymentReceived(recipientId, emp.amount, currency, merchantId).catch(() => {});
      } catch (e: any) {
        results.push({
          phone: emp.phone,
          name: emp.name,
          amount: emp.amount,
          status: "failed",
          reason: e.message || "Transfer failed",
        });
      }
    }

    return {
      success: true,
      data: { totalPaid, successCount, failedCount: employees.length - successCount, results },
      message: `Payroll complete: ${successCount}/${employees.length} transfers succeeded`,
    };
  }
);
