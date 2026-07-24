import { describe, expect, it } from "vitest";
import { parseEditConfirmationFromErrorMessage } from "./editConfirmation";

describe("parseEditConfirmationFromErrorMessage", () => {
  it("parses a plain confirmation payload", () => {
    expect(
      parseEditConfirmationFromErrorMessage(
        'CONFIRM_EDIT_EFFECTS::{"confirmationLines":["Из маршрута будут убраны роли: HOD."],"infoLines":[]}',
      ),
    ).toEqual({
      confirmationLines: ["Из маршрута будут убраны роли: HOD."],
      infoLines: [],
    });
  });

  it("parses a Convex wrapped server error", () => {
    expect(
      parseEditConfirmationFromErrorMessage(
        'CONVEX M(requests:editRequest)] [Request ID: 160a6082f48d91e9] Server Error Uncaught Error: CONFIRM_EDIT_EFFECTS::{"confirmationLines":["Из маршрута будут убраны роли: HOD.","Изменение цехов для руководителя цеха обновит маршрут согласования."],"infoLines":[]} at handler (../convex/requests.ts:3091:8) Called by client',
      ),
    ).toEqual({
      confirmationLines: [
        "Из маршрута будут убраны роли: HOD.",
        "Изменение цехов для руководителя цеха обновит маршрут согласования.",
      ],
      infoLines: [],
    });
  });

  it("returns null for regular errors", () => {
    expect(parseEditConfirmationFromErrorMessage("Укажите способ оплаты")).toBeNull();
  });
});
