import { describe, expect, it } from "vitest";
import { getEffectiveQuotaAllocations, sumQuotaUsageByMonth, sumQuotaUsageByMonthAndTag } from "../convex/quotaUsage";

describe("quotaUsage", () => {
  it("allocates approved requests to expense expectation month", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "approved",
      amount: 15000,
      amountWithVat: 18300,
      vatRate: 22,
      currency: "RUB",
      approvalDeadline: new Date("2026-04-10").getTime(),
      neededBy: new Date("2026-05-10").getTime(),
    });

    expect(allocations).toEqual([
      { monthKey: "2026-05", amountWithoutVat: 15000, amountWithVat: 18300 },
    ]);
  });

  it("uses full payment target for planned partial payments", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "payment_planned",
      amount: 100,
      amountWithVat: 120,
      vatRate: 20,
      paymentResidualAmount: 120,
      paymentResidualAmountWithVat: 144,
      plannedPaymentAmount: 50,
      plannedPaymentAmountWithVat: 60,
      currency: "USD",
      paymentCurrencyRate: 90,
      approvalDeadline: new Date("2026-04-10").getTime(),
      neededBy: new Date("2026-04-20").getTime(),
      paymentPlannedAt: new Date("2026-05-15").getTime(),
    });

    expect(allocations).toEqual([
      { monthKey: "2026-04", amountWithoutVat: 10800, amountWithVat: 12960 },
    ]);
  });

  it("keeps partially paid requests in expense expectation month", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "partially_paid",
      amount: 1000,
      amountWithVat: 1220,
      vatRate: 22,
      paymentResidualAmount: 400,
      paymentResidualAmountWithVat: 488,
      plannedPaymentAmount: 250,
      plannedPaymentAmountWithVat: 305,
      currency: "RUB",
      approvalDeadline: new Date("2026-04-10").getTime(),
      neededBy: new Date("2026-04-20").getTime(),
      paymentPlannedAt: new Date("2026-06-01").getTime(),
      paymentSplits: [
        { amountWithoutVat: 300, amountWithVat: 366, paidAt: new Date("2026-05-05").getTime() },
        { amountWithoutVat: 300, amountWithVat: 366, paidAt: new Date("2026-05-20").getTime() },
      ],
    });

    expect(allocations).toEqual([
      { monthKey: "2026-04", amountWithoutVat: 1000, amountWithVat: 1220 },
    ]);
  });

  it("ignores planned payment months for quota allocation", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "payment_planned",
      amount: 1000,
      amountWithVat: 1220,
      vatRate: 22,
      currency: "RUB",
      approvalDeadline: new Date("2026-04-10").getTime(),
      neededBy: new Date("2026-04-20").getTime(),
      paymentResidualAmount: 1000,
      paymentResidualAmountWithVat: 1220,
      plannedPaymentAmount: 300,
      plannedPaymentAmountWithVat: 366,
      paymentPlannedAt: new Date("2026-06-01").getTime(),
      plannedPaymentSplits: [
        {
          amountWithoutVat: 250,
          amountWithVat: 305,
          plannedAt: new Date("2026-05-15").getTime(),
        },
      ],
    });

    expect(allocations).toEqual([
      { monthKey: "2026-04", amountWithoutVat: 1000, amountWithVat: 1220 },
    ]);
  });

  it("uses final paid total in expense expectation month", () => {
    const allocations = getEffectiveQuotaAllocations({
      status: "paid",
      currency: "RUB",
      actualPaidAmount: 1000,
      actualPaidAmountWithVat: 1220,
      vatRate: 22,
      approvalDeadline: new Date("2026-04-10").getTime(),
      neededBy: new Date("2026-04-20").getTime(),
      paidAt: new Date("2026-06-15").getTime(),
      paymentSplits: [
        { amountWithoutVat: 250, amountWithVat: 305, paidAt: new Date("2026-05-10").getTime() },
      ],
    });

    expect(allocations).toEqual([
      { monthKey: "2026-04", amountWithoutVat: 1000, amountWithVat: 1220 },
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
        neededBy: new Date("2026-04-20").getTime(),
        cfdTag: "Tag A",
      },
      {
        status: "pending",
        amount: 999,
        amountWithVat: 1218.78,
        vatRate: 22,
        currency: "RUB",
        approvalDeadline: new Date("2026-04-10").getTime(),
        neededBy: new Date("2026-04-20").getTime(),
        cfdTag: "Tag B",
      },
      {
        status: "approved",
        amount: 50,
        amountWithVat: 61,
        vatRate: 22,
        currency: "RUB",
        approvalDeadline: new Date("2026-04-10").getTime(),
        neededBy: new Date("2026-04-20").getTime(),
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

  it("does not allocate Welcome bonus requests to quotas", () => {
    expect(
      getEffectiveQuotaAllocations({
        status: "approved",
        category: "Welcome-бонус",
        amount: 1000,
        amountWithVat: 1220,
        vatRate: 22,
        currency: "RUB",
        neededBy: new Date("2026-04-20").getTime(),
      }),
    ).toEqual([]);
  });
});
