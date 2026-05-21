import { describe, expect, it } from "vitest";
import { FINANCE_LEGAL_DEPARTMENT } from "../src/lib/departments";
import {
  ACCOUNTING_REQUEST_AREA,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  PURCHASE_CATEGORY,
} from "../src/lib/requestRules";
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
    ).toEqual([FINANCE_LEGAL_DEPARTMENT, "Разработка", ACCOUNTING_REQUEST_AREA]);
  });

  it("adds HOD role when finance HOD is required", () => {
    const departments = getEffectiveRequiredHodDepartments({
      category: "Закупка",
      requiredHodDepartments: [FINANCE_LEGAL_DEPARTMENT],
    });

    expect(departments).toEqual([FINANCE_LEGAL_DEPARTMENT, ACCOUNTING_REQUEST_AREA]);
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

  it("requires NBD for welcome bonus and contest requests only", () => {
    expect(
      getEffectiveRequiredRoles({
        requiredRoles: [],
        category: "Welcome-бонус",
      }),
    ).toEqual(["NBD"]);

    expect(
      getEffectiveRequiredRoles({
        requiredRoles: [],
        category: "Конкурсное задание",
      }),
    ).toEqual(["NBD"]);

    expect(
      getEffectiveRequiredRoles({
        requiredRoles: [],
        category: PURCHASE_CATEGORY,
      }),
    ).not.toContain("NBD");
  });

  it("requires Accounting HOD for purchase, gifts, informal events, and merch", () => {
    for (const category of [
      PURCHASE_CATEGORY,
      "Подарки",
      "Неформальное мероприятие",
      "Совместный мерч",
    ]) {
      expect(
        getEffectiveRequiredHodDepartments({
          category,
          requiredHodDepartments: [],
        }),
      ).toContain(ACCOUNTING_REQUEST_AREA);
    }
  });

  it("requires Accounting HOD when contractor specialists are present", () => {
    expect(
      getEffectiveRequiredHodDepartments({
        category: CLIENT_SERVICES_TRANSIT_CATEGORY,
        requiredHodDepartments: [],
        specialists: [
          {
            sourceType: "contractor",
            name: "Подрядчик",
          },
        ],
      }),
    ).toContain(ACCOUNTING_REQUEST_AREA);

    expect(
      getEffectiveRequiredHodDepartments({
        category: CLIENT_SERVICES_TRANSIT_CATEGORY,
        requiredHodDepartments: [],
        specialists: [
          {
            sourceType: "contractor",
          },
        ],
      }),
    ).not.toContain(ACCOUNTING_REQUEST_AREA);
  });
});
