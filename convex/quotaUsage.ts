function monthKeyFromTimestamp(timestamp?: number) {
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toRubAmount(
  amount: number,
  currency: string,
  currencyRate?: number,
) {
  if (currency === "RUB") {
    return amount;
  }
  if (currencyRate && Number.isFinite(currencyRate) && currencyRate > 0) {
    return amount * currencyRate;
  }
  return amount;
}

export function getEffectiveQuotaAllocations(request: any) {
  if (
    request.isCanceled ||
    ["draft", "pending", "rejected"].includes(request.status)
  ) {
    return [] as Array<{ monthKey: string; amount: number }>;
  }

  const approvalMonthKey = monthKeyFromTimestamp(
    request.approvalDeadline ?? request.submittedAt ?? request.createdAt,
  );
  const plannedMonthKey = monthKeyFromTimestamp(request.paymentPlannedAt);
  const paidMonthKey = monthKeyFromTimestamp(request.paidAt);
  const latestRate = request.paymentCurrencyRate;
  const paymentSplits = request.paymentSplits ?? [];

  const splitAllocations = paymentSplits
    .map((split: any) => {
      const monthKey = monthKeyFromTimestamp(split.paidAt);
      if (!monthKey) {
        return null;
      }
      return {
        monthKey,
        amount: toRubAmount(
          split.amountWithoutVat ?? 0,
          request.currency,
          split.currencyRate ?? latestRate,
        ),
      };
    })
    .filter(Boolean) as Array<{ monthKey: string; amount: number }>;

  const requestAmount = request.amount ?? 0;
  const plannedAmount = request.plannedPaymentAmount ?? request.actualPaidAmount ?? requestAmount;
  const residualAmount =
    request.paymentResidualAmount ??
    Math.max(plannedAmount - paymentSplits.reduce((sum: number, split: any) => sum + (split.amountWithoutVat ?? 0), 0), 0);

  if (request.status === "approved") {
    if (!approvalMonthKey) return [];
    return [
      {
        monthKey: approvalMonthKey,
        amount: toRubAmount(requestAmount, request.currency, latestRate),
      },
    ];
  }

  if (["awaiting_payment", "payment_planned"].includes(request.status)) {
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (!monthKey) return [];
    return [
      {
        monthKey,
        amount: toRubAmount(plannedAmount, request.currency, latestRate),
      },
    ];
  }

  if (request.status === "partially_paid") {
    const allocations = [...splitAllocations];
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (monthKey && residualAmount > 0) {
      allocations.push({
        monthKey,
        amount: toRubAmount(residualAmount, request.currency, latestRate),
      });
    }
    return allocations;
  }

  if (request.status === "paid" || request.status === "closed") {
    if (paymentSplits.length > 0) {
      const allocations = [...splitAllocations];
      const totalAmount = request.actualPaidAmount ?? plannedAmount;
      const splitTotal = paymentSplits.reduce(
        (sum: number, split: any) => sum + (split.amountWithoutVat ?? 0),
        0,
      );
      const finalAmount = Math.max(totalAmount - splitTotal, 0);
      const monthKey = paidMonthKey ?? plannedMonthKey ?? approvalMonthKey;
      if (monthKey && finalAmount > 0) {
        allocations.push({
          monthKey,
          amount: toRubAmount(finalAmount, request.currency, latestRate),
        });
      }
      if (!allocations.length && monthKey) {
        allocations.push({
          monthKey,
          amount: toRubAmount(totalAmount, request.currency, latestRate),
        });
      }
      return allocations;
    }

    const monthKey = paidMonthKey ?? plannedMonthKey ?? approvalMonthKey;
    if (!monthKey) return [];
    return [
      {
        monthKey,
        amount: toRubAmount(
          request.actualPaidAmount ?? plannedAmount,
          request.currency,
          latestRate,
        ),
      },
    ];
  }

  return [];
}

export function sumQuotaUsageByMonth(
  requests: any[],
  predicate: (request: any) => boolean,
) {
  const totals = new Map<string, number>();
  for (const request of requests) {
    if (!predicate(request)) {
      continue;
    }
    for (const allocation of getEffectiveQuotaAllocations(request)) {
      totals.set(
        allocation.monthKey,
        (totals.get(allocation.monthKey) ?? 0) + allocation.amount,
      );
    }
  }
  return totals;
}
