import { describe, expect, it } from "vitest";
import {
  getApprovalStatusClass,
  getBuhPaymentStatusSummary,
  getRequestStatusSummary,
  getUnallocatedPaymentAmounts,
  hasUnallocatedPayment,
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
    expect(getRequestStatusSummary({ status: "rejected" }).label).toBe("Не согласовано");
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
});
