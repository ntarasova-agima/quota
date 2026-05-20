import { describe, expect, it } from "vitest";
import { FINANCE_LEGAL_DEPARTMENT } from "../src/lib/departments";
import {
  getEffectiveRequiredHodDepartments,
  getEffectiveRequiredRoles,
} from "../convex/requestWorkflow";

describe("requestWorkflow", () => {
  it("keeps finance HOD approval instead of replacing it with CFD", () => {
    expect(
      getEffectiveRequiredHodDepartments({
        category: "Закупка",
        requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT, "Разработка"],
      }),
    ).toEqual([FINANCE_LEGAL_DEPARTMENT, "Разработка"]);
  });

  it("adds HOD role when finance HOD is required", () => {
    const departments = getEffectiveRequiredHodDepartments({
      category: "Закупка",
      requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT],
    });

    expect(departments).toEqual([FINANCE_LEGAL_DEPARTMENT]);
    expect(
      getEffectiveRequiredRoles({
        requiredRoles: [],
        requiredHodDepartments: departments,
        category: "Закупка",
      }),
    ).toEqual(["HOD"]);
  });
});
