import { describe, expect, it } from "vitest";
import { hasConflictingSpecialistTaxFlags, isContestSpecialistValidated, isGoogleSheetsLink } from "./requestFields";

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

  it("recognizes Google Sheets links", () => {
    expect(isGoogleSheetsLink("https://docs.google.com/spreadsheets/d/abc/edit#gid=0")).toBe(true);
    expect(isGoogleSheetsLink("https://example.com")).toBe(false);
  });
});
