import { describe, expect, it } from "vitest";
import {
  getPaymentProgressStatus,
  getRequestPaymentRemainingAmounts,
  getRequestPaymentTargetAmounts,
  validateQuotaResolutionBeforePayment,
} from "../convex/requests";

describe("request payment helpers", () => {
  it("uses request amount as payment target before any payment progress", () => {
    expect(
      getRequestPaymentTargetAmounts({
        amount: 100_000,
        amountWithVat: 122_000,
        vatRate: 22,
      }),
    ).toEqual({
      amountWithoutVat: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
    });
  });

  it("uses only contractor specialists as payment target", () => {
    expect(
      getRequestPaymentTargetAmounts({
        amount: 6,
        amountWithVat: 6,
        vatRate: 0,
        specialists: [
          { sourceType: "internal", directCost: 4 },
          { sourceType: "contractor", directCost: 2 },
        ],
      }),
    ).toEqual({
      amountWithoutVat: 2,
      amountWithVat: 2,
      vatRate: 0,
    });
  });

  it("has no payment target for internal-only specialist requests", () => {
    expect(
      getRequestPaymentTargetAmounts({
        amount: 4,
        amountWithVat: 4,
        vatRate: 0,
        specialists: [{ sourceType: "internal", directCost: 4 }],
      }),
    ).toEqual({
      amountWithoutVat: 0,
      amountWithVat: 0,
      vatRate: 0,
    });
  });

  it("uses paid splits plus residual as payment target during partial payment", () => {
    expect(
      getRequestPaymentTargetAmounts({
        amount: 100_000,
        amountWithVat: 122_000,
        vatRate: 22,
        paymentSplits: [
          {
            amountWithoutVat: 30_000,
            amountWithVat: 36_600,
            vatRate: 22,
          },
        ],
        paymentResidualAmount: 70_000,
        paymentResidualAmountWithVat: 85_400,
      }),
    ).toEqual({
      amountWithoutVat: 100_000,
      amountWithVat: 122_000,
    });
  });

  it("uses explicit residual as remaining amount", () => {
    expect(
      getRequestPaymentRemainingAmounts({
        amount: 100_000,
        amountWithVat: 122_000,
        vatRate: 22,
        paymentResidualAmount: 40_000,
        paymentResidualAmountWithVat: 48_800,
      }),
    ).toEqual({
      amountWithoutVat: 40_000,
      amountWithVat: 48_800,
      vatRate: 22,
    });
  });

  it("resolves progress status from paid and planned entries", () => {
    expect(
      getPaymentProgressStatus({
        paidSplitsCount: 1,
        hasPlannedPayments: false,
      }),
    ).toBe("partially_paid");
    expect(
      getPaymentProgressStatus({
        paidSplitsCount: 0,
        hasPlannedPayments: true,
      }),
    ).toBe("payment_planned");
    expect(
      getPaymentProgressStatus({
        paidSplitsCount: 0,
        hasPlannedPayments: false,
      }),
    ).toBe("awaiting_payment");
  });
});

describe("validateQuotaResolutionBeforePayment", () => {
  it("requires a resolved funding source before payment", () => {
    expect(() =>
      validateQuotaResolutionBeforePayment({
        fundingSource: "Я не знаю",
      }),
    ).toThrow("Укажите источник финансирования");
  });

  it("requires quota tag for AGIMA quota payment", () => {
    expect(() =>
      validateQuotaResolutionBeforePayment({
        fundingSource: "Квоты AGIMA",
      }),
    ).toThrow("Укажите тег заявки");
  });

  it("allows AGIMA quota payment when tag is set", () => {
    expect(() =>
      validateQuotaResolutionBeforePayment({
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
      }),
    ).not.toThrow();
  });

  it("allows transit tag to skip quota tag resolution", () => {
    expect(() =>
      validateQuotaResolutionBeforePayment({
        fundingSource: "Квоты AGIMA",
        cfdTag: "Транзит",
      }),
    ).not.toThrow();
  });
});
