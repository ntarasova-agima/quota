import { describe, expect, it } from "vitest";
import { isContestSpecialistValidated } from "./requestFields";

describe("requestFields", () => {
  it("requires HR validation for GPH contractors even without a department", () => {
    expect(
      isContestSpecialistValidated({
        sourceType: "contractor",
        contractorTypes: ["ГПХ"],
        directCost: 10_000,
      }),
    ).toBe(false);

    expect(
      isContestSpecialistValidated({
        sourceType: "contractor",
        contractorTypes: ["ГПХ"],
        directCost: 10_000,
        hodConfirmed: true,
      }),
    ).toBe(true);
  });
});
