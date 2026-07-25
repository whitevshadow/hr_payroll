import api from "../lib/api";
import type { PayoutBatch, PayoutTransaction } from "../types";

export const payoutApi = {
  getBatches: (cycleId: string) =>
    api
      .get<PayoutBatch[]>(`/payouts/batches/${cycleId}`)
      .then((r) => r.data),

  getTransactions: (batchId: string) =>
    api
      .get<PayoutTransaction[]>(`/payouts/transactions/${batchId}`)
      .then((r) => r.data),
};
