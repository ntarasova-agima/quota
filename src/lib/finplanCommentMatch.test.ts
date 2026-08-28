import { describe, expect, it } from "vitest";
import {
  extractFirstAurumRequestCode,
  getFinplanCostSyncWindow,
  getFinplanCostUrl,
} from "./finplanCommentMatch";

describe("finplanCommentMatch", () => {
  it("extracts a request code from a long comment", () => {
    expect(
      extractFirstAurumRequestCode("Оплата по заявке WB_QA_00010, закупка в июле"),
    ).toBe("WB_QA_00010");
  });

  it("returns the first request code when several are mentioned", () => {
    expect(
      extractFirstAurumRequestCode("первая WB_QA_00010, вторая CT_QS_00042"),
    ).toBe("WB_QA_00010");
  });

  it("normalizes lower-case comments", () => {
    expect(extractFirstAurumRequestCode("см. wb_qa_00010")).toBe("WB_QA_00010");
  });

  it("does not extract partial request codes embedded into longer tokens", () => {
    expect(extractFirstAurumRequestCode("XXXWB_QA_00010")).toBeNull();
    expect(extractFirstAurumRequestCode("WB_QA_00010YYY")).toBeNull();
  });

  it("returns null for comments without a request code", () => {
    expect(extractFirstAurumRequestCode("работает 7 часов в день")).toBeNull();
    expect(extractFirstAurumRequestCode("")).toBeNull();
    expect(extractFirstAurumRequestCode(undefined)).toBeNull();
  });

  it("builds a Finplan cost row URL", () => {
    expect(getFinplanCostUrl("215366")).toBe(
      "https://finplan.agimagroup.ru/finance/costs/?arFilter%5BID%5D=215366",
    );
  });

  it("builds a four-month sync window around request creation date", () => {
    expect(getFinplanCostSyncWindow(Date.UTC(2026, 7, 17))).toEqual({
      from: "01.06.2026",
      to: "31.10.2026",
      raw: {
        "arFilter[>=COST_DATE]": "01.06.2026",
        "arFilter[<=COST_DATE]": "31.10.2026",
      },
    });
  });
});
