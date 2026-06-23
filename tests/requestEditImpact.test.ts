import { describe, expect, it } from "vitest";
import { buildEditImpact } from "../convex/requests";

const baseRequest = {
  title: "Test request",
  category: "Закупка",
  amount: 100_000,
  amountWithVat: 122_000,
  fundingSource: "Квоты AGIMA",
  counterparty: "Vendor A",
  neededBy: new Date("2026-05-15").getTime(),
  approvalDeadline: new Date("2026-04-20").getTime(),
  requiredRoles: ["COO", "CFD"],
};

const approvedCooApproval = {
  role: "COO",
  status: "approved",
  reviewerEmail: "coo@agima.ru",
};

const pendingCfdApproval = {
  role: "CFD",
  status: "pending",
};

describe("buildEditImpact", () => {
  it("resets all required roles when amount changes after approval progress", () => {
    const impact = buildEditImpact(
      baseRequest,
      { ...baseRequest, amount: 150_000, amountWithVat: 183_000 },
      [approvedCooApproval, pendingCfdApproval],
    );

    expect(impact.triggerRepeatApproval).toBe(true);
    expect(impact.routeChanged).toBe(true);
    expect(impact.shouldAskForConfirmation).toBe(true);
    expect(impact.rolesToReset).toEqual(["COO", "CFD"]);
    expect(impact.confirmationLines).toContain(
      "Изменение суммы отправит заявку на повторное согласование.",
    );
  });

  it("does not reset approvals for category change but notifies approved reviewers", () => {
    const impact = buildEditImpact(
      baseRequest,
      { ...baseRequest, category: "Подарки" },
      [approvedCooApproval, pendingCfdApproval],
    );

    expect(impact.triggerRepeatApproval).toBe(false);
    expect(impact.routeChanged).toBe(false);
    expect(impact.notifyApprovedEmails).toEqual(["coo@agima.ru"]);
    expect(impact.infoLines).toContain(
      "Изменение типа заявки не сбросит согласование, но уведомит уже согласовавших.",
    );
  });

  it("does not reset approvals for counterparty change but marks BUH notification", () => {
    const impact = buildEditImpact(
      baseRequest,
      { ...baseRequest, counterparty: "Vendor B" },
      [approvedCooApproval, pendingCfdApproval],
    );

    expect(impact.triggerRepeatApproval).toBe(false);
    expect(impact.routeChanged).toBe(false);
    expect(impact.counterpartyChanged).toBe(true);
    expect(impact.infoLines).toContain(
      "Изменение контрагента не сбросит согласование, но уведомит BUH.",
    );
  });

  it("asks for confirmation when roles are added or removed", () => {
    const impact = buildEditImpact(
      baseRequest,
      { ...baseRequest, requiredRoles: ["COO", "NBD"] },
      [approvedCooApproval, pendingCfdApproval],
    );

    expect(impact.triggerRepeatApproval).toBe(true);
    expect(impact.routeChanged).toBe(true);
    expect(impact.removedRoles).toEqual(["CFD"]);
    expect(impact.addedRoles).toEqual(["NBD"]);
    expect(impact.rolesToReset).toEqual(["NBD"]);
    expect(impact.shouldAskForConfirmation).toBe(true);
  });
});
