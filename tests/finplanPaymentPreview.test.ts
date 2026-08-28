import { describe, expect, it } from "vitest";
import { buildFinplanPaymentPreview } from "../convex/finplanSync";

describe("Finplan payment preview", () => {
  it("compares Finplan rows with the contractor payment target for specialist requests", async () => {
    const preview = await buildFinplanPaymentPreview({
      costs: [
        {
          id: "213469",
          comment: "AD_BU_12345",
          costSumNet: 21_000,
          costSum: 21_000,
          paymentDeadline: "22.09.2026",
        },
      ],
      request: {
        requestCode: "AD_BU_12345",
        amount: 73_375.7,
        amountWithVat: 73_375.7,
        currency: "RUB",
        status: "payment_planned",
        specialists: [
          {
            sourceType: "internal",
            directCost: 52_375.7,
          },
          {
            sourceType: "contractor",
            directCost: 21_000,
            amountIncludesTaxes: true,
          },
        ],
      },
    });

    expect(preview.comparison.requestAmountWithoutVat).toBe(21_000);
    expect(preview.comparison.differenceWithoutVat).toBe(0);
    expect(preview.comparison.amountMatches).toBe(true);
    expect(preview.warnings).not.toContain("Сумма Финплана меньше суммы заявки");
  });
});
