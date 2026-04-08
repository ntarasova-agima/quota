import { describe, expect, it } from "vitest";
import { getApprovalStatusClass, getRequestStatusSummary } from "./requestStatus";

describe("requestStatus", () => {
  it("prioritizes canceled status", () => {
    expect(getRequestStatusSummary({ status: "approved", isCanceled: true }).label).toBe("Отменена");
  });

  it("shows partial approval progress", () => {
    expect(
      getRequestStatusSummary(
        { status: "pending" },
        [{ status: "approved" }, { status: "pending" }, { status: "approved" }],
      ).label,
    ).toBe("Частично согласовано: 2/3");
  });

  it("returns approved and rejected terminal labels", () => {
    expect(getRequestStatusSummary({ status: "approved" }).label).toBe("Согласовано");
    expect(getRequestStatusSummary({ status: "rejected" }).label).toBe("Не согласовано");
  });

  it("maps approval badge classes", () => {
    expect(getApprovalStatusClass("approved")).toContain("emerald");
    expect(getApprovalStatusClass("rejected")).toContain("rose");
    expect(getApprovalStatusClass("pending")).toContain("amber");
  });
});
