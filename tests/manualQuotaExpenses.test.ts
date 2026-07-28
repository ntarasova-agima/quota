import { describe, expect, it } from "vitest";
import { prepareManualExpenseCounterparties } from "../src/lib/manualQuotaExpenses";

describe("manual quota expense editing", () => {
  it("updates both counterparties, preserves their ids, and recalculates the exact total", () => {
    expect(
      prepareManualExpenseCounterparties(
        [
          { id: "line-a", name: "Старый А", amount: 100 },
          { id: "line-b", name: "Старый Б", amount: 200 },
        ],
        [
          { id: "line-a", name: "Новый А", amount: 125.55 },
          { id: "line-b", name: "Новый Б", amount: 274.45 },
        ],
        "seed",
      ),
    ).toEqual({
      counterparties: [
        { id: "line-a", name: "Новый А", amount: 125.55 },
        { id: "line-b", name: "Новый Б", amount: 274.45 },
      ],
      amount: 400,
    });
  });

  it("assigns a stable new id without changing existing counterparty ids", () => {
    expect(
      prepareManualExpenseCounterparties(
        [{ id: "line-a", name: "А", amount: 100 }],
        [
          { id: "line-a", name: "А", amount: 100 },
          { name: "Б", amount: 50 },
        ],
        "seed",
      ).counterparties,
    ).toEqual([
      { id: "line-a", name: "А", amount: 100 },
      { id: "manual-seed-1", name: "Б", amount: 50 },
    ]);
  });
});
