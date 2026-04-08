import { describe, expect, it } from "vitest";
import { formatRoleList, getRoleLabel } from "./roleLabels";

describe("roleLabels", () => {
  it("maps AD to a human readable label", () => {
    expect(getRoleLabel("AD")).toBe("Автор заявки");
  });

  it("leaves unknown roles intact", () => {
    expect(getRoleLabel("CFD")).toBe("CFD");
  });

  it("formats role lists", () => {
    expect(formatRoleList(["AD", "CFD"])).toBe("Автор заявки, CFD");
  });
});
