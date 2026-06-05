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
});
