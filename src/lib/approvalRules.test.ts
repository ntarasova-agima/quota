import { describe, expect, it } from "vitest";
import { getAutoRequiredRolesForRequest } from "./approvalRules";

describe("approvalRules", () => {
  it("requires COO approval for contest requests with contractor specialists", () => {
    expect(
      getAutoRequiredRolesForRequest({
        category: "Конкурсное задание",
        specialists: [{ sourceType: "contractor", name: "Иван Иванов" }],
      }),
    ).toContain("COO");
  });

  it("does not require COO approval for contest requests with only internal specialists", () => {
    expect(
      getAutoRequiredRolesForRequest({
        category: "Конкурсное задание",
        specialists: [{ sourceType: "internal" }],
      }),
    ).not.toContain("COO");
  });

  it("does not require COO approval for empty contractor draft rows", () => {
    expect(
      getAutoRequiredRolesForRequest({
        category: "Конкурсное задание",
        specialists: [{ sourceType: "contractor", name: "", contractorTypes: [] }],
      }),
    ).not.toContain("COO");
  });

  it("does not require COO approval for non-contest requests with contractor specialists", () => {
    expect(
      getAutoRequiredRolesForRequest({
        category: "Подарки",
        specialists: [{ sourceType: "contractor" }],
      }),
    ).not.toContain("COO");
  });
});
