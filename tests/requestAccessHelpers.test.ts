import { describe, expect, it } from "vitest";
import {
  canEditRequest,
  hasNbdAccountingEditAccess,
  hasSpecialBuhAccessToRequest,
} from "../convex/requestAccessHelpers";

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

  it("allows NBD to edit accounting requests", () => {
    const request = {
      requestArea: "Аккаунтинг",
      department: "Аккаунтинг",
    };

    expect(hasNbdAccountingEditAccess({ roles: ["NBD"] }, request)).toBe(true);
    expect(
      canEditRequest({
        isCreator: false,
        roleRecord: { roles: ["NBD"] },
        request,
      }),
    ).toBe(true);
  });

  it("does not allow NBD to edit administration requests", () => {
    const request = {
      requestArea: "Администрация",
      department: "Администрация",
    };

    expect(hasNbdAccountingEditAccess({ roles: ["NBD"] }, request)).toBe(false);
    expect(
      canEditRequest({
        isCreator: false,
        roleRecord: { roles: ["NBD"] },
        request,
      }),
    ).toBe(false);
  });

  it("keeps creator and admin edit access", () => {
    const request = {
      requestArea: "Администрация",
      department: "Администрация",
    };

    expect(
      canEditRequest({
        isCreator: true,
        roleRecord: { roles: [] },
        request,
      }),
    ).toBe(true);
    expect(
      canEditRequest({
        isCreator: false,
        roleRecord: { roles: ["ADMIN"] },
        request,
      }),
    ).toBe(true);
  });
});
