import type { Tx } from "../client";
import { usageEvents } from "../schema";

type UsageType = (typeof usageEvents.$inferInsert)["type"];

/** Append-only usage ledger; the source for per-tenant metering and billing (Week 5). */
export function usageRepo(tx: Tx, orgId: string) {
  return {
    record: async (type: UsageType, quantity: number, metadata: Record<string, unknown> = {}) => {
      await tx.insert(usageEvents).values({ orgId, type, quantity, metadata });
    },
  };
}
