import { describe, expect, it } from "vitest";
import { FINANCE_LEGAL_DEPARTMENT } from "../src/lib/departments";
import { CLIENT_SERVICES_TRANSIT_CATEGORY } from "../src/lib/requestRules";
import {
  buildApprovalTargets,
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

  it("requires BUH Transit for transit requests", () => {
    expect(
      getEffectiveRequiredRoles({
        requiredRoles: ["HOD"],
        requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT],
        category: CLIENT_SERVICES_TRANSIT_CATEGORY,
      }),
    ).toEqual(["HOD", "BUH Transit"]);

    expect(
      getEffectiveRequiredRoles({
        requiredRoles: ["BUH"],
        category: CLIENT_SERVICES_TRANSIT_CATEGORY,
      }),
    ).toEqual(["BUH Transit"]);

    expect(
      buildApprovalTargets({
        requiredRoles: ["HOD"],
        requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT],
        category: CLIENT_SERVICES_TRANSIT_CATEGORY,
      }),
    ).toEqual([
      { role: "HOD", department: FINANCE_LEGAL_DEPARTMENT },
      { role: "BUH Transit" },
    ]);
  });
});
