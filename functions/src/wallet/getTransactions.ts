import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, centsToDollars } from "../utils/validation";
import { ApiResponse, Transaction, TransactionStatus } from "../types";

interface TransactionResponse {
  id: string;
  type: string;
  amount: number; // Gross, in dollars
  fee: number; // Platform fee, in dollars
  net: number; // Amount received after fees, in dollars
  commission: number; // Agent commission, in dollars
  currency: string;
  status: TransactionStatus;
  description: string;
  reference?: string;
  createdAt: Date;
  completedAt?: Date;
  isIncoming: boolean;
  otherPartyId: string;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  refundedAt?: Date;
  refundOfTransactionId?: string;
}

interface GetTransactionsRequest {
  limit?: number;
  status?: TransactionStatus;
  /** createdAt of the last item from the previous page, in epoch millis. */
  cursor?: number;
}

interface GetTransactionsResult extends ApiResponse<TransactionResponse[]> {
  nextCursor: number | null;
}

const MAX_LIMIT = 100;

/**
 * Resolve a set of user ids to display name + phone, preferring the merchant
 * business name where one exists. Batched to two getAll() reads.
 */
async function resolveParties(
  db: FirebaseFirestore.Firestore,
  ids: string[]
): Promise<Map<string, { name: string | null; phone: string | null }>> {
  const out = new Map<string, { name: string | null; phone: string | null }>();
  if (ids.length === 0) return out;

  const userRefs = ids.map((id) => db.collection("users").doc(id));
  const merchantRefs = ids.map((id) => db.collection("merchantProfiles").doc(id));
  const [userDocs, merchantDocs] = await Promise.all([
    db.getAll(...userRefs),
    db.getAll(...merchantRefs),
  ]);

  ids.forEach((id, i) => {
    const user = userDocs[i].data();
    const merchant = merchantDocs[i].data();
    const name =
      (merchant?.businessName as string) || (user?.fullName as string) || null;
    const phone = (user?.phoneNumber as string) || null;
    out.set(id, { name, phone });
  });

  return out;
}

/**
 * Callable function to get a page of the user's transaction history.
 * Uses a single participants array-contains query so paging is cursor-based.
 */
export const getTransactions = https.onCall(
  async (
    request: https.CallableRequest<GetTransactionsRequest>
  ): Promise<GetTransactionsResult> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { status, cursor } = request.data;
    const limit = Math.min(Math.max(request.data.limit ?? 50, 1), MAX_LIMIT);

    try {
      const db = admin.firestore();

      let query: FirebaseFirestore.Query = db
        .collection("transactions")
        .where("participants", "array-contains", userId);

      if (status) {
        query = query.where("status", "==", status);
      }

      query = query.orderBy("createdAt", "desc");

      if (typeof cursor === "number" && Number.isFinite(cursor)) {
        query = query.startAfter(admin.firestore.Timestamp.fromMillis(cursor));
      }

      const snapshot = await query.limit(limit).get();

      // Collect distinct counterparties (excluding self) for a batched lookup.
      const partyIds = new Set<string>();
      snapshot.forEach((doc) => {
        const data = doc.data() as Transaction;
        const otherId =
          data.fromUserId === userId ? data.toUserId : data.fromUserId;
        if (otherId && otherId !== userId) {
          partyIds.add(otherId);
        }
      });

      const parties = await resolveParties(db, Array.from(partyIds));

      const transactions: TransactionResponse[] = snapshot.docs.map((doc) => {
        const data = doc.data() as Transaction;

        // For a self top-up/withdrawal both ids are the user; direction follows
        // the type. Otherwise the user is incoming when they are the receiver.
        const isIncoming =
          data.fromUserId === data.toUserId
            ? data.type !== "withdrawal"
            : data.toUserId === userId;

        const otherId =
          data.fromUserId === userId ? data.toUserId : data.fromUserId;
        const party =
          otherId && otherId !== userId ? parties.get(otherId) : undefined;

        const netCents = data.netCents ?? data.amount;

        return {
          id: doc.id,
          type: data.type,
          amount: centsToDollars(data.amount),
          fee: centsToDollars(data.feeCents ?? 0),
          net: centsToDollars(netCents),
          commission: centsToDollars(data.commissionCents ?? 0),
          currency: data.currency,
          status: data.status,
          description: data.description,
          reference: data.reference,
          createdAt: data.createdAt.toDate(),
          completedAt: data.completedAt?.toDate(),
          isIncoming,
          otherPartyId: otherId,
          counterpartyName: party?.name ?? null,
          counterpartyPhone: party?.phone ?? null,
          refundedAt: data.refundedAt?.toDate(),
          refundOfTransactionId: data.refundOfTransactionId,
        };
      });

      const last = snapshot.docs[snapshot.docs.length - 1];
      const nextCursor =
        snapshot.size === limit && last
          ? (last.data() as Transaction).createdAt.toMillis()
          : null;

      return {
        success: true,
        data: transactions,
        nextCursor,
      };
    } catch (error: any) {
      console.error("Error getting transactions:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get transactions"
      );
    }
  }
);
