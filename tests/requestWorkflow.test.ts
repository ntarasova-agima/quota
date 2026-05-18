import { describe, expect, it } from "vitest";
import { FINANCE_LEGAL_DEPARTMENT } from "../src/lib/departments";
import {
  getEffectiveRequiredHodDepartments,
  getEffectiveRequiredRoles,
} from "../convex/requestWorkflow";

describe("requestWorkflow", () => {
  it("does not create a separate finance HOD approval because CFD covers it", () => {
    expect(
      getEffectiveRequiredHodDepartments({
        category: "Закупка",
        requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT, "Разработка"],
      }),
    ).toEqual(["Разработка"]);
  });

  it("does not add HOD role when only finance HOD would be required", () => {
    const departments = getEffectiveRequiredHodDepartments({
      category: "Закупка",
      requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT],
    });

    expect(departments).toEqual([]);
    expect(
      getEffectiveRequiredRoles({
        requiredRoles: ["CFD"],
        requiredHodDepartments: departments,
        category: "Закупка",
      }),
    ).toEqual(["CFD"]);
  });
});
