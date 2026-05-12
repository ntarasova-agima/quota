import { describe, expect, it } from "vitest";
import { hasConflictingSpecialistTaxFlags, isContestSpecialistValidated } from "./requestFields";

describe("requestFields", () => {
  it("does not require personnel department validation for GPH contractors", () => {
    expect(
      isContestSpecialistValidated({
        sourceType: "contractor",
        contractorTypes: ["ГПХ"],
        directCost: 10_000,
      }),
    ).toBe(true);
  });

  it("keeps known tax composition mutually exclusive", () => {
    expect(
      hasConflictingSpecialistTaxFlags({
        amountIncludesTaxes: true,
        amountExcludesTaxes: true,
      }),
    ).toBe(true);
    expect(
      hasConflictingSpecialistTaxFlags({
        amountIncludesTaxes: true,
      }),
    ).toBe(false);
  });
});
