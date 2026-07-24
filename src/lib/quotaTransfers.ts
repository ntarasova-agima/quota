export type QuotaTransfer = {
  sourceMonthKey: string;
  targetMonthKey: string;
  amount: number;
};

export type QuotaAllocation = {
  monthKey: string;
  amount: number;
  transferredFromMonthKeys: string[];
};

export function roundQuotaAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getQuotaAllocations(
  baseMonthKey: string,
  baseAmount: number,
  transfers: QuotaTransfer[],
) {
  const balances = new Map<string, number>([[baseMonthKey, roundQuotaAmount(baseAmount)]]);
  const origins = new Map<string, Set<string>>();

  for (const transfer of transfers) {
    const amount = roundQuotaAmount(transfer.amount);
    balances.set(
      transfer.sourceMonthKey,
      roundQuotaAmount((balances.get(transfer.sourceMonthKey) ?? 0) - amount),
    );
    balances.set(
      transfer.targetMonthKey,
      roundQuotaAmount((balances.get(transfer.targetMonthKey) ?? 0) + amount),
    );
    const targetOrigins = origins.get(transfer.targetMonthKey) ?? new Set<string>();
    targetOrigins.add(transfer.sourceMonthKey);
    origins.set(transfer.targetMonthKey, targetOrigins);
  }

  return Array.from(balances.entries())
    .filter(([, amount]) => amount > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, amount]): QuotaAllocation => ({
      monthKey,
      amount,
      transferredFromMonthKeys: Array.from(origins.get(monthKey) ?? []).sort(),
    }));
}

export function getQuotaAllocationBalance(
  baseMonthKey: string,
  baseAmount: number,
  transfers: QuotaTransfer[],
  monthKey: string,
) {
  return getQuotaAllocations(baseMonthKey, baseAmount, transfers).find(
    (allocation) => allocation.monthKey === monthKey,
  )?.amount ?? 0;
}
