import { describe, expect, it } from "vitest";
import { resolveCopiedRequestCoreFields } from "./requestCopy";

describe("requestCopy", () => {
  it("restores copied category and funding source from request code when legacy fields are empty", () => {
    expect(
      resolveCopiedRequestCoreFields({
        category: "",
        department: "Аккаунтинг",
        fundingSource: "",
        requestCode: "CT_QA_00012",
      }),
    ).toEqual({
      category: "Конкурсное задание",
      department: "Аккаунтинг",
      fundingSource: "Квоты AGIMA",
    });
  });

  it("falls back to a valid category and funding source when old requests have no core fields", () => {
    expect(
      resolveCopiedRequestCoreFields({
        category: undefined,
        department: "Аккаунтинг",
        fundingSource: undefined,
        requestCode: undefined,
      }),
    ).toEqual({
      category: "Welcome-бонус",
      department: "Аккаунтинг",
      fundingSource: "Квоты AGIMA",
    });
  });

  it("does not keep a category that is not available for the request department", () => {
    expect(
      resolveCopiedRequestCoreFields({
        category: "Несуществующий тип",
        department: "Аккаунтинг",
        fundingSource: "Квоты AGIMA",
      }),
    ).toEqual({
      category: "Welcome-бонус",
      department: "Аккаунтинг",
      fundingSource: "Квоты AGIMA",
    });
  });
});
