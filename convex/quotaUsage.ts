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
    request.category === "Welcome-бонус" ||
    ["draft", "hod_pending", "pending", "rejected"].includes(request.status)
  ) {
    return [] as Array<{ monthKey: string; amountWithoutVat: number; amountWithVat: number }>;
  }

  const expenseMonthKey = monthKeyFromTimestamp(request.neededBy ?? request.createdAt);
  const latestRate = request.paymentCurrencyRate;
  const paymentTargetAmounts = getRequestPaymentTargetAmounts(request);
  if (!expenseMonthKey) {
    return [];
  }
  const amountWithoutVat = paymentTargetAmounts.amountWithoutVat ?? request.amount ?? 0;
  const amountWithVat =
    getAmountWithVat(
      amountWithoutVat,
      paymentTargetAmounts.amountWithVat ?? request.amountWithVat,
      request.vatRate,
    ) ?? amountWithoutVat;
  return [
    {
      monthKey: expenseMonthKey,
      ...toRubVatAmounts({
        amountWithoutVat,
        amountWithVat,
        currency: request.currency,
        currencyRate: latestRate,
        vatRate: request.vatRate,
      }),
    },
  ];
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
