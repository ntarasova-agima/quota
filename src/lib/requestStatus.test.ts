import { describe, expect, it } from "vitest";
import {
  getApprovalStatusClass,
  getBuhPaymentStatusSummary,
  getFotActionHint,
  getPaymentActionHint,
  getPaymentDeadlineTimestamp,
  getPaymentTaskTimestamp,
  getRequestStatusSummary,
  getUnallocatedPaymentAmounts,
  hasUnallocatedPayment,
  isOpenPaymentTask,
  matchesPaymentTaskFilter,
} from "./requestStatus";

describe("requestStatus", () => {
  it("prioritizes canceled status", () => {
    expect(getRequestStatusSummary({ status: "approved", isCanceled: true }).label).toBe("Отменена");
  });

  it("shows partial approval progress", () => {
    expect(
      getRequestStatusSummary(
        { status: "pending" },
        [{ status: "approved" }, { status: "pending" }, { status: "approved" }],
      ).label,
    ).toBe("Частично согласовано: 2/3");
  });

  it("returns approved and rejected terminal labels", () => {
    expect(getRequestStatusSummary({ status: "approved" }).label).toBe("Согласовано");
    expect(getRequestStatusSummary({ status: "awaiting_payment" }).label).toBe("Согласовано");
    expect(getRequestStatusSummary({ status: "rejected" }).label).toBe("Не согласовано");
  });

  it("calls saved draft requests drafts", () => {
    expect(getRequestStatusSummary({ status: "draft" }).label).toBe("Черновик");
  });

  it("maps approval badge classes", () => {
    expect(getApprovalStatusClass("approved")).toContain("emerald");
    expect(getApprovalStatusClass("rejected")).toContain("rose");
    expect(getApprovalStatusClass("pending")).toContain("amber");
  });

  it("detects unallocated payment remainder for BUH", () => {
    expect(
      hasUnallocatedPayment({
        status: "payment_planned",
        paymentResidualAmount: 1000,
        paymentResidualAmountWithVat: 1220,
        plannedPaymentAmount: 300,
        plannedPaymentAmountWithVat: 366,
        vatRate: 22,
      }),
    ).toBe(true);

    expect(
      getUnallocatedPaymentAmounts({
        status: "payment_planned",
        paymentResidualAmount: 1000,
        paymentResidualAmountWithVat: 1220,
        plannedPaymentAmount: 300,
        plannedPaymentAmountWithVat: 366,
        vatRate: 22,
      }),
    ).toEqual({
      amountWithoutVat: 700,
      amountWithVat: 854,
    });
  });

  it("returns BUH payment status for unallocated remainder", () => {
    expect(
      getBuhPaymentStatusSummary({
        status: "partially_paid",
        paymentResidualAmount: 500,
        vatRate: 22,
      }).label,
    ).toBe("Есть нераспределенный платеж");
  });

  it("keeps payment action hints separate from request status", () => {
    expect(
      getPaymentActionHint({
        status: "approved",
        paymentDeadline: 5000,
      })?.label,
    ).toBe("Нужно запланировать или оплатить");

    expect(
      getPaymentActionHint({
        status: "payment_planned",
        paymentResidualAmount: 1000,
        plannedPaymentAmount: 300,
        vatRate: 22,
        paymentPlannedAt: 5000,
      })?.label,
    ).toBe("Есть нераспределенный платеж");

    expect(
      getRequestStatusSummary({
        status: "payment_planned",
        paymentResidualAmount: 1000,
        plannedPaymentAmount: 300,
        vatRate: 22,
        paymentPlannedAt: 5000,
      }).label,
    ).toBe("Запланирована оплата");
  });

  it("subtracts archived planned payments from unallocated remainder", () => {
    expect(
      getUnallocatedPaymentAmounts({
        status: "payment_planned",
        paymentResidualAmount: 1000,
        paymentResidualAmountWithVat: 1220,
        plannedPaymentAmount: 200,
        plannedPaymentAmountWithVat: 244,
        plannedPaymentSplits: [
          {
            amountWithoutVat: 300,
            amountWithVat: 366,
            vatRate: 22,
          },
        ],
        vatRate: 22,
      }),
    ).toEqual({
      amountWithoutVat: 500,
      amountWithVat: 610,
    });
  });

  it("treats fully approved contractor requests as open payment tasks", () => {
    expect(isOpenPaymentTask({ status: "approved", paymentDeadline: 1000 })).toBe(true);
    expect(isOpenPaymentTask({ status: "approved", paymentDeadline: 1000, category: "Welcome-бонус" })).toBe(false);
    expect(
      isOpenPaymentTask({
        status: "approved",
        paymentDeadline: 1000,
        specialists: [{ sourceType: "internal" }],
      }),
    ).toBe(false);
    expect(
      isOpenPaymentTask({
        status: "approved",
        paymentDeadline: 1000,
        specialists: [{ sourceType: "internal" }, { sourceType: "contractor" }],
      }),
    ).toBe(true);
    expect(isOpenPaymentTask({ status: "approved" })).toBe(true);
    expect(isOpenPaymentTask({ status: "paid", paymentDeadline: 1000 })).toBe(false);
  });

  it("detects pending FOT as a separate task", () => {
    const request = {
      status: "approved" as const,
      category: "Конкурсное задание",
      specialists: [{ sourceType: "internal", fotRecorded: false }],
    };

    expect(getFotActionHint(request)?.label).toBe("Нужно вынести ФОТ");
    expect(matchesPaymentTaskFilter(request, "fot", 3000, 3999)).toBe(true);
    expect(matchesPaymentTaskFilter(request, "open", 3000, 3999)).toBe(true);
    expect(
      getFotActionHint({
        ...request,
        category: "Welcome-бонус",
      }),
    ).toBeNull();
  });

  it("uses planned payment dates before deadline dates for payment task filters", () => {
    expect(
      getPaymentTaskTimestamp({
        status: "payment_planned",
        paymentDeadline: 5000,
        paymentPlannedAt: 3000,
      }),
    ).toBe(3000);

    expect(
      getPaymentTaskTimestamp({
        status: "partially_paid",
        paymentDeadline: 7000,
        plannedPaymentSplits: [{ plannedAt: 6000 }],
        paymentSplits: [{ nextPaymentAt: 4000 }],
      }),
    ).toBe(4000);

    expect(getPaymentDeadlineTimestamp({ paymentDeadline: 9000, neededBy: 1000 })).toBe(9000);
  });

  it("filters payment tasks by the effective payment date", () => {
    const todayStart = 3000;
    const todayEnd = 3999;
    const request = {
      status: "payment_planned" as const,
      paymentDeadline: 9000,
      paymentPlannedAt: 3500,
    };

    expect(matchesPaymentTaskFilter(request, "today", todayStart, todayEnd)).toBe(true);
    expect(matchesPaymentTaskFilter(request, "overdue", todayStart, todayEnd)).toBe(false);
  });
});
