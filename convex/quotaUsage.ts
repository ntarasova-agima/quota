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
  const plannedAmountWithoutVat =
    request.plannedPaymentAmount ?? request.actualPaidAmount ?? requestAmountWithoutVat;
  const plannedAmountWithVat =
    getAmountWithVat(
      plannedAmountWithoutVat,
      request.plannedPaymentAmountWithVat ?? request.actualPaidAmountWithVat,
      request.vatRate,
    ) ?? plannedAmountWithoutVat;
  const residualAmountWithoutVat =
    request.paymentResidualAmount ??
    Math.max(
      plannedAmountWithoutVat -
        paymentSplits.reduce((sum: number, split: any) => sum + (split.amountWithoutVat ?? 0), 0),
      0,
    );
  const residualAmountWithVat = getAmountWithVat(
    residualAmountWithoutVat,
    undefined,
    request.vatRate,
  ) ?? residualAmountWithoutVat;

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
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (!monthKey) return [];
    const amounts = toRubVatAmounts({
      amountWithoutVat: plannedAmountWithoutVat,
      amountWithVat: plannedAmountWithVat,
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

  if (request.status === "partially_paid") {
    const allocations = [...splitAllocations];
    const monthKey = plannedMonthKey ?? approvalMonthKey;
    if (monthKey && residualAmountWithoutVat > 0) {
      const amounts = toRubVatAmounts({
        amountWithoutVat: residualAmountWithoutVat,
        amountWithVat: residualAmountWithVat,
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

  if (request.status === "paid" || request.status === "closed") {
    if (paymentSplits.length > 0) {
      const allocations = [...splitAllocations];
      const totalAmountWithoutVat = request.actualPaidAmount ?? plannedAmountWithoutVat;
      const totalAmountWithVat =
        getAmountWithVat(
          totalAmountWithoutVat,
          request.actualPaidAmountWithVat ?? request.plannedPaymentAmountWithVat,
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
      amountWithoutVat: request.actualPaidAmount ?? plannedAmountWithoutVat,
      amountWithVat: request.actualPaidAmountWithVat ?? plannedAmountWithVat,
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
