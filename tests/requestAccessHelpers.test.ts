import { describe, expect, it } from "vitest";
import { hasSpecialBuhAccessToRequest } from "../convex/requestAccessHelpers";

describe("requestAccessHelpers", () => {
  it("allows specialist BUH roles to open any request with specialists", () => {
    const contractorOnlyRequest = {
      status: "approved",
      specialists: [
        {
          sourceType: "contractor",
          contractorTypes: ["IP"],
          name: "Contractor",
        },
      ],
    };

    expect(
      hasSpecialBuhAccessToRequest(
        { roles: ["BUH Inside"] },
        contractorOnlyRequest,
      ),
    ).toBe(true);
    expect(
      hasSpecialBuhAccessToRequest(
        { roles: ["BUH Outsource"] },
        contractorOnlyRequest,
      ),
    ).toBe(true);
  });

  it("does not allow specialist BUH roles to open requests without specialists", () => {
    expect(
      hasSpecialBuhAccessToRequest(
        { roles: ["BUH Inside"] },
        { status: "approved", specialists: [] },
      ),
    ).toBe(false);
  });
});
