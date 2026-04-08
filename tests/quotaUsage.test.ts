import { describe, expect, it } from "vitest";
import { getEffectiveQuotaAllocations, sumQuotaUsageByMonth, sumQuotaUsageByMonthAndTag } from "../convex/quotaUsage";

describe("quotaUsage", () => {
  it("allocates approved requests to approval month", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "approved",
      amount: 15000,
      amountWithVat: 18300,
      vatRate: 22,
      currency: "RUB",
      approvalDeadline: new Date("2026-04-10").getTime(),
    });

    expect(allocations).toEqual([
      { monthKey: "2026-04", amountWithoutVat: 15000, amountWithVat: 18300 },
    ]);
  });

  it("uses planned payment month and currency rate for planned payments", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "payment_planned",
      amount: 100,
      amountWithVat: 120,
      vatRate: 20,
      plannedPaymentAmount: 120,
      plannedPaymentAmountWithVat: 144,
      currency: "USD",
      paymentCurrencyRate: 90,
      approvalDeadline: new Date("2026-04-10").getTime(),
      paymentPlannedAt: new Date("2026-05-15").getTime(),
    });

    expect(allocations).toEqual([
      { monthKey: "2026-05", amountWithoutVat: 10800, amountWithVat: 12960 },
    ]);
  });

  it("splits partially paid requests between paid splits and residual plan", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "partially_paid",
      amount: 1000,
      amountWithVat: 1220,
      vatRate: 22,
      plannedPaymentAmount: 1000,
      paymentResidualAmount: 400,
      currency: "RUB",
      approvalDeadline: new Date("2026-04-10").getTime(),
      paymentPlannedAt: new Date("2026-06-01").getTime(),
      paymentSplits: [
        { amountWithoutVat: 300, amountWithVat: 366, paidAt: new Date("2026-05-05").getTime() },
        { amountWithoutVat: 300, amountWithVat: 366, paidAt: new Date("2026-05-20").getTime() },
      ],
    });

    expect(allocations).toEqual([
      { monthKey: "2026-05", amountWithoutVat: 300, amountWithVat: 366 },
      { monthKey: "2026-05", amountWithoutVat: 300, amountWithVat: 366 },
      { monthKey: "2026-06", amountWithoutVat: 400, amountWithVat: 488 },
    ]);
  });

  it("uses split totals and final remainder for fully paid requests", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "paid",
      currency: "RUB",
      actualPaidAmount: 1000,
      actualPaidAmountWithVat: 1220,
      vatRate: 22,
      approvalDeadline: new Date("2026-04-10").getTime(),
      paidAt: new Date("2026-06-15").getTime(),
      paymentSplits: [
        { amountWithoutVat: 250, amountWithVat: 305, paidAt: new Date("2026-05-10").getTime() },
      ],
    });

    expect(allocations).toEqual([
      { monthKey: "2026-05", amountWithoutVat: 250, amountWithVat: 305 },
      { monthKey: "2026-06", amountWithoutVat: 750, amountWithVat: 915 },
    ]);
  });

  it("ignores canceled and non-effective statuses in aggregations", () => {
    const requests = [
      {
        status: "approved",
        amount: 100,
        amountWithVat: 122,
        vatRate: 22,
        currency: "RUB",
        approvalDeadline: new Date("2026-04-10").getTime(),
        cfdTag: "Tag A",
      },
      {
        status: "pending",
        amount: 999,
        amountWithVat: 1218.78,
        vatRate: 22,
        currency: "RUB",
        approvalDeadline: new Date("2026-04-10").getTime(),
        cfdTag: "Tag B",
      },
      {
        status: "approved",
        amount: 50,
        amountWithVat: 61,
        vatRate: 22,
        currency: "RUB",
        approvalDeadline: new Date("2026-04-10").getTime(),
        isCanceled: true,
        cfdTag: "Tag C",
      },
    ];

    expect(sumQuotaUsageByMonth(requests, () => true).get("2026-04")).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 122,
    });
    expect(sumQuotaUsageByMonthAndTag(requests, () => true).get("2026-04")?.get("Tag A")).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 122,
    });
  });
});
