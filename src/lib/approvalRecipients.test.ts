import { describe, expect, it } from "vitest";
import { dedupeEmails, getActiveRoleEmails, getApprovalRecipients, type ApprovalRoleRecord } from "./approvalRecipients";

const roleDocs: ApprovalRoleRecord[] = [
  { active: true, email: "nbd@agima.ru", roles: ["NBD"] },
  { active: true, email: "ai@agima.ru", roles: ["AI-BOSS"] },
  { active: true, email: "admin@agima.ru", roles: ["ADMIN"] },
  { active: true, email: "dual@agima.ru", roles: ["NBD", "ADMIN"] },
  { active: false, email: "inactive@agima.ru", roles: ["NBD"] },
];

describe("approvalRecipients", () => {
  it("deduplicates recipients and excludes author", () => {
    expect(dedupeEmails(["A@agima.ru", "a@agima.ru", "b@agima.ru"], ["a@agima.ru"])).toEqual(["b@agima.ru"]);
  });

  it("returns only active emails for requested roles", () => {
    expect(getActiveRoleEmails(roleDocs, ["NBD"])).toEqual(["nbd@agima.ru", "dual@agima.ru"]);
  });

  it("uses assigned approvers when a role is staffed", () => {
    expect(getApprovalRecipients(roleDocs, ["NBD"], ["dual@agima.ru"])).toEqual(["nbd@agima.ru"]);
  });

  it("falls back to admins for every unstaffed role", () => {
    expect(getApprovalRecipients(roleDocs, ["COO"], [])).toEqual(["admin@agima.ru", "dual@agima.ru"]);
  });

  it("mixes staffed roles and admin fallback per missing role", () => {
    expect(getApprovalRecipients(roleDocs, ["NBD", "COO"], ["dual@agima.ru"])).toEqual([
      "nbd@agima.ru",
      "admin@agima.ru",
    ]);
  });
});
