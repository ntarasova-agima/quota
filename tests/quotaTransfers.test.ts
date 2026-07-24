import { describe, expect, it } from "vitest";
import {
  getQuotaAllocationBalance,
  getQuotaAllocations,
  roundQuotaAmount,
} from "../src/lib/quotaTransfers";

describe("quota transfers", () => {
  it("splits an approved request amount between months", () => {
    const allocations = getQuotaAllocations("2026-07", 1000, [
      { sourceMonthKey: "2026-07", targetMonthKey: "2026-08", amount: 400 },
    ]);

    expect(allocations).toEqual([
      { monthKey: "2026-07", amount: 600, transferredFromMonthKeys: [] },
      { monthKey: "2026-08", amount: 400, transferredFromMonthKeys: ["2026-07"] },
    ]);
  });

  it("can transfer part of an already transferred manual expense onward", () => {
    const allocations = getQuotaAllocations("2026-07", 1000, [
      { sourceMonthKey: "2026-07", targetMonthKey: "2026-08", amount: 400 },
      { sourceMonthKey: "2026-08", targetMonthKey: "2026-09", amount: 150 },
    ]);

    expect(allocations).toEqual([
      { monthKey: "2026-07", amount: 600, transferredFromMonthKeys: [] },
      { monthKey: "2026-08", amount: 250, transferredFromMonthKeys: ["2026-07"] },
      { monthKey: "2026-09", amount: 150, transferredFromMonthKeys: ["2026-08"] },
    ]);
  });

  it("supports moving an allocation backward", () => {
    const transfers = [
      { sourceMonthKey: "2026-07", targetMonthKey: "2026-08", amount: 400 },
      { sourceMonthKey: "2026-08", targetMonthKey: "2026-06", amount: 125 },
    ];

    expect(getQuotaAllocationBalance("2026-07", 1000, transfers, "2026-08")).toBe(275);
    expect(getQuotaAllocations("2026-07", 1000, transfers)).toEqual([
      { monthKey: "2026-06", amount: 125, transferredFromMonthKeys: ["2026-08"] },
      { monthKey: "2026-07", amount: 600, transferredFromMonthKeys: [] },
      { monthKey: "2026-08", amount: 275, transferredFromMonthKeys: ["2026-07"] },
    ]);
  });

  it("preserves the original total after several transfers", () => {
    const allocations = getQuotaAllocations("2026-07", 1000, [
      { sourceMonthKey: "2026-07", targetMonthKey: "2026-08", amount: 333.33 },
      { sourceMonthKey: "2026-07", targetMonthKey: "2026-09", amount: 111.11 },
      { sourceMonthKey: "2026-08", targetMonthKey: "2026-10", amount: 22.22 },
    ]);

    expect(roundQuotaAmount(allocations.reduce((sum, allocation) => sum + allocation.amount, 0))).toBe(1000);
  });

  it("rounds money to two decimal places", () => {
    expect(roundQuotaAmount(10.005)).toBe(10.01);
    expect(roundQuotaAmount(10.004)).toBe(10);
  });
});
