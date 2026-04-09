import { getAmountWithVat } from "../src/lib/vat";

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

function toRubVatAmounts(params: {
  amountWithoutVat: number;
  amountWithVat?: number;
  currency: string;
  currencyRate?: number;
  vatRate?: number;
}) {
  const amountWithVat = getAmountWithVat(
    params.amountWithoutVat,
    params.amountWithVat,
    params.vatRate,
  ) ?? params.amountWithoutVat;
  return {
    amountWithoutVat: toRubAmount(
      params.amountWithoutVat,
      params.currency,
      params.currencyRate,
    ),
    amountWithVat: toRubAmount(
      amountWithVat,
      params.currency,
      params.currencyRate,
    ),
  };
}

function sumPaymentSplitAmounts(paymentSplits: any[]) {
  return paymentSplits.reduce((sum: number, split: any) => sum + (split.amountWithoutVat ?? 0), 0);
}

function sumPaymentSplitAmountsWithVat(paymentSplits: any[], vatRate?: number) {
  return paymentSplits.reduce((sum: number, split: any) => {
    const amountWithVat =
      getAmountWithVat(split.amountWithoutVat ?? 0, split.amountWithVat, split.vatRate ?? vatRate) ??
      (split.amountWithoutVat ?? 0);
    return sum + amountWithVat;
  }, 0);
}

function sumPlannedPaymentSplitAmounts(plannedPaymentSplits: any[] = []) {
  return plannedPaymentSplits.reduce((sum: number, split: any) => sum + (split.amountWithoutVat ?? 0), 0);
}

function sumPlannedPaymentSplitAmountsWithVat(plannedPaymentSplits: any[] = [], vatRate?: number) {
  return plannedPaymentSplits.reduce((sum: number, split: any) => {
    const amountWithVat =
      getAmountWithVat(split.amountWithoutVat ?? 0, split.amountWithVat, split.vatRate ?? vatRate) ??
      (split.amountWithoutVat ?? 0);
    return sum + amountWithVat;
  }, 0);
}

function getPlannedPaymentAllocations(request: any) {
  const archived = (request.plannedPaymentSplits ?? [])
    .map((split: any) => {
      const monthKey = monthKeyFromTimestamp(split.plannedAt);
      if (!monthKey) {
        return null;
      }
      const amounts = toRubVatAmounts({
        amountWithoutVat: split.amountWithoutVat ?? 0,
        amountWithVat: split.amountWithVat,
        currency: request.currency,
        currencyRate: split.currencyRate ?? request.paymentCurrencyRate,
        vatRate: split.vatRate ?? request.vatRate,
      });
      return {
        monthKey,
        ...amounts,
      };
    })
    .filter(Boolean);

  if (request.paymentPlannedAt && (request.plannedPaymentAmount !== undefined || request.plannedPaymentAmountWithVat !== undefined)) {
    archived.push({
      monthKey: monthKeyFromTimestamp(request.paymentPlannedAt),
      ...toRubVatAmounts({
        amountWithoutVat: request.plannedPaymentAmount ?? 0,
        amountWithVat: request.plannedPaymentAmountWithVat,
        currency: request.currency,
        currencyRate: request.paymentCurrencyRate,
        vatRate: request.vatRate,
      }),
    });
  }

  return archived.filter((item: any) => item?.monthKey);
}

function getUnallocatedPaymentAmounts(request: any) {
  const residual = getRequestPaymentResidualAmounts(request);
  const archivedPlannedWithoutVat = sumPlannedPaymentSplitAmounts(request.plannedPaymentSplits ?? []);
  const archivedPlannedWithVat = sumPlannedPaymentSplitAmountsWithVat(
    request.plannedPaymentSplits ?? [],
    request.vatRate,
  );
  const currentPlannedWithVat =
    getAmountWithVat(
      request.plannedPaymentAmount ?? 0,
      request.plannedPaymentAmountWithVat,
      request.vatRate,
    ) ?? (request.plannedPaymentAmount ?? 0);

  return {
    amountWithoutVat: Math.max(
      (residual.amountWithoutVat ?? 0) -
        archivedPlannedWithoutVat -
        (request.plannedPaymentAmount ?? 0),
      0,
    ),
    amountWithVat: Math.max(
      (residual.amountWithVat ?? 0) -
        archivedPlannedWithVat -
        currentPlannedWithVat,
      0,
    ),
  };
}

function getRequestPaymentTargetAmounts(request: any) {
  const paymentSplits = request.paymentSplits ?? [];
  const splitTotalWithoutVat = sumPaymentSplitAmounts(paymentSplits);
  const splitTotalWithVat = sumPaymentSplitAmountsWithVat(paymentSplits, request.vatRate);
  if (request.paymentResidualAmount !== undefined || request.paymentResidualAmountWithVat !== undefined) {
    const residualAmountWithoutVat = request.paymentResidualAmount ?? 0;
    const residualAmountWithVat =
      getAmountWithVat(
        residualAmountWithoutVat,
        request.paymentResidualAmountWithVat,
        request.vatRate,
      ) ?? residualAmountWithoutVat;
    return {
      amountWithoutVat: splitTotalWithoutVat + residualAmountWithoutVat,
      amountWithVat: splitTotalWithVat + residualAmountWithVat,
    };
  }

  const amountWithoutVat = request.actualPaidAmount ?? request.amount ?? 0;
  const amountWithVat =
    getAmountWithVat(
      amountWithoutVat,
      request.actualPaidAmountWithVat ?? request.amountWithVat,
      request.vatRate,
    ) ?? amountWithoutVat;
  return {
    amountWithoutVat,
    amountWithVat,
  };
}

function getRequestPaymentResidualAmounts(request: any) {
  if (request.paymentResidualAmount !== undefined || request.paymentResidualAmountWithVat !== undefined) {
    const amountWithoutVat = request.paymentResidualAmount ?? 0;
    const amountWithVat =
      getAmountWithVat(
        amountWithoutVat,
        request.paymentResidualAmountWithVat,
        request.vatRate,
      ) ?? amountWithoutVat;
    return {
      amountWithoutVat,
      amountWithVat,
    };
  }
  return getRequestPaymentTargetAmounts(request);
}

export function getEffectiveQuotaAllocations(request: any) {
  if (
    request.isCanceled ||
    ["draft", "pending", "rejected"].includes(request.status)
  ) {
    return [] as Array<{ monthKey: string; amountWithoutVat: number; amountWithVat: number }>;
  }

  const approvalMonthKey = monthKeyFromTimestamp(
    request.approvalDeadline ?? request.submittedAt ?? request.createdAt,
  );
  const plannedMonthKey = monthKeyFromTimestamp(request.paymentPlannedAt);
  const paidMonthKey = monthKeyFromTimestamp(request.paidAt);
  const latestRate = request.paymentCurrencyRate;
  const paymentSplits = request.paymentSplits ?? [];
  const paymentTargetAmounts = getRequestPaymentTargetAmounts(request);
  const paymentResidualAmounts = getRequestPaymentResidualAmounts(request);
  const plannedAllocations = getPlannedPaymentAllocations(request);
  const unallocatedPaymentAmounts = getUnallocatedPaymentAmounts(request);

  const splitAllocations = paymentSplits
    .map((split: any) => {
      const monthKey = monthKeyFromTimestamp(split.paidAt);
      if (!monthKey) {
        return null;
      }
      const amounts = toRubVatAmounts({
        amountWithoutVat: split.amountWithoutVat ?? 0,
        amountWithVat: split.amountWithVat,
        currency: request.currency,
        currencyRate: split.currencyRate ?? latestRate,
        vatRate: split.vatRate ?? request.vatRate,
      });
      return {
        monthKey,
        ...amounts,
      };
    })
    .filter(Boolean) as Array<{ monthKey: string; amountWithoutVat: number; amountWithVat: number }>;

  const requestAmountWithoutVat = request.amount ?? 0;
  const requestAmountWithVat =
    getAmountWithVat(requestAmountWithoutVat, request.amountWithVat, request.vatRate) ??
    requestAmountWithoutVat;

  if (request.status === "approved") {
    if (!approvalMonthKey) return [];
    const amounts = toRubVatAmounts({
      amountWithoutVat: requestAmountWithoutVat,
      amountWithVat: requestAmountWithVat,
      currency: request.currency,
      currencyRate: latestRate,
      vatRate: request.vatRate,
    });
    return [
      {
        monthKey: approvalMonthKey,
        ...amounts,
      },
    ];
  }

  if (["awaiting_payment", "payment_planned"].includes(request.status)) {
    if ((request.plannedPaymentSplits?.length ?? 0) === 0) {
      const monthKey = plannedMonthKey ?? approvalMonthKey;
      if (!monthKey) return [];
      return [{
        monthKey,
        ...toRubVatAmounts({
          amountWithoutVat: paymentTargetAmounts.amountWithoutVat,
          amountWithVat: paymentTargetAmounts.amountWithVat,
          currency: request.currency,
          currencyRate: latestRate,
          vatRate: request.vatRate,
        }),
      }];
    }
    const allocations = [...plannedAllocations];
    if (unallocatedPaymentAmounts.amountWithoutVat > 0) {
      const monthKey = plannedMonthKey ?? approvalMonthKey;
      if (monthKey) {
        allocations.push({
          monthKey,
          ...toRubVatAmounts({
            amountWithoutVat: unallocatedPaymentAmounts.amountWithoutVat,
            amountWithVat: unallocatedPaymentAmounts.amountWithVat,
            currency: request.currency,
            currencyRate: latestRate,
            vatRate: request.vatRate,
          }),
        });
      }
    }
    if (allocations.length) {
      return allocations;
    }
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (!monthKey) return [];
    return [{
      monthKey,
      ...toRubVatAmounts({
        amountWithoutVat: paymentTargetAmounts.amountWithoutVat,
        amountWithVat: paymentTargetAmounts.amountWithVat,
        currency: request.currency,
        currencyRate: latestRate,
        vatRate: request.vatRate,
      }),
    }];
  }

  if (request.status === "partially_paid") {
    if ((request.plannedPaymentSplits?.length ?? 0) === 0) {
      const allocations = [...splitAllocations];
      const monthKey = plannedMonthKey ?? approvalMonthKey;
      if (monthKey && paymentResidualAmounts.amountWithoutVat > 0) {
        allocations.push({
          monthKey,
          ...toRubVatAmounts({
            amountWithoutVat: paymentResidualAmounts.amountWithoutVat,
            amountWithVat: paymentResidualAmounts.amountWithVat,
            currency: request.currency,
            currencyRate: latestRate,
            vatRate: request.vatRate,
          }),
        });
      }
      return allocations;
    }
    const allocations = [...splitAllocations, ...plannedAllocations];
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (monthKey && unallocatedPaymentAmounts.amountWithoutVat > 0) {
      allocations.push({
        monthKey,
        ...toRubVatAmounts({
          amountWithoutVat: unallocatedPaymentAmounts.amountWithoutVat,
          amountWithVat: unallocatedPaymentAmounts.amountWithVat,
          currency: request.currency,
          currencyRate: latestRate,
          vatRate: request.vatRate,
        }),
      });
    }
    return allocations;
  }

  if (request.status === "paid" || request.status === "closed") {
    if (paymentSplits.length > 0) {
      const allocations = [...splitAllocations];
      const totalAmountWithoutVat = request.actualPaidAmount ?? paymentTargetAmounts.amountWithoutVat;
      const totalAmountWithVat =
        getAmountWithVat(
          totalAmountWithoutVat,
          request.actualPaidAmountWithVat ?? paymentTargetAmounts.amountWithVat,
          request.vatRate,
        ) ?? totalAmountWithoutVat;
      const splitTotalWithoutVat = paymentSplits.reduce(
        (sum: number, split: any) => sum + (split.amountWithoutVat ?? 0),
        0,
      );
      const splitTotalWithVat = paymentSplits.reduce(
        (sum: number, split: any) =>
          sum + (getAmountWithVat(split.amountWithoutVat ?? 0, split.amountWithVat, split.vatRate ?? request.vatRate) ?? 0),
        0,
      );
      const finalAmountWithoutVat = Math.max(totalAmountWithoutVat - splitTotalWithoutVat, 0);
      const finalAmountWithVat = Math.max(totalAmountWithVat - splitTotalWithVat, 0);
      const monthKey = paidMonthKey ?? plannedMonthKey ?? approvalMonthKey;
      if (monthKey && finalAmountWithoutVat > 0) {
        const amounts = toRubVatAmounts({
          amountWithoutVat: finalAmountWithoutVat,
          amountWithVat: finalAmountWithVat,
          currency: request.currency,
          currencyRate: latestRate,
          vatRate: request.vatRate,
        });
        allocations.push({
          monthKey,
          ...amounts,
        });
      }
      if (!allocations.length && monthKey) {
        const amounts = toRubVatAmounts({
          amountWithoutVat: totalAmountWithoutVat,
          amountWithVat: totalAmountWithVat,
          currency: request.currency,
          currencyRate: latestRate,
          vatRate: request.vatRate,
        });
        allocations.push({
          monthKey,
          ...amounts,
        });
      }
      return allocations;
    }

    const monthKey = paidMonthKey ?? plannedMonthKey ?? approvalMonthKey;
    if (!monthKey) return [];
    const amounts = toRubVatAmounts({
      amountWithoutVat: request.actualPaidAmount ?? paymentTargetAmounts.amountWithoutVat,
      amountWithVat: request.actualPaidAmountWithVat ?? paymentTargetAmounts.amountWithVat,
      currency: request.currency,
      currencyRate: latestRate,
      vatRate: request.vatRate,
    });
    return [
      {
        monthKey,
        ...amounts,
      },
    ];
  }

  return [];
}

export function sumQuotaUsageByMonth(
  requests: any[],
  predicate: (request: any) => boolean,
) {
  const totals = new Map<string, { amountWithoutVat: number; amountWithVat: number }>();
  for (const request of requests) {
    if (!predicate(request)) {
      continue;
    }
    for (const allocation of getEffectiveQuotaAllocations(request)) {
      const current = totals.get(allocation.monthKey) ?? { amountWithoutVat: 0, amountWithVat: 0 };
      totals.set(
        allocation.monthKey,
        {
          amountWithoutVat: current.amountWithoutVat + allocation.amountWithoutVat,
          amountWithVat: current.amountWithVat + allocation.amountWithVat,
        },
      );
    }
  }
  return totals;
}

export function sumQuotaUsageByMonthAndTag(
  requests: any[],
  predicate: (request: any) => boolean,
) {
  const totals = new Map<string, Map<string, { amountWithoutVat: number; amountWithVat: number }>>();
  for (const request of requests) {
    if (!predicate(request)) {
      continue;
    }
    const tag = request.cfdTag?.trim() || "Без тега";
    for (const allocation of getEffectiveQuotaAllocations(request)) {
      if (!totals.has(allocation.monthKey)) {
        totals.set(
          allocation.monthKey,
          new Map<string, { amountWithoutVat: number; amountWithVat: number }>(),
        );
      }
      const monthTotals = totals.get(allocation.monthKey)!;
      const current = monthTotals.get(tag) ?? { amountWithoutVat: 0, amountWithVat: 0 };
      monthTotals.set(tag, {
        amountWithoutVat: current.amountWithoutVat + allocation.amountWithoutVat,
        amountWithVat: current.amountWithVat + allocation.amountWithVat,
      });
    }
  }
  return totals;
}
