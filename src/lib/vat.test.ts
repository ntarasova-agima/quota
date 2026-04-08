import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAT_RATE,
  calculateAmountWithVat,
  calculateAmountWithoutVat,
  formatAmountPair,
  matchesCalculatedAmountWithVat,
  resolveVatAmounts,
} from "./vat";

describe("vat", () => {
  it("calculates with vat and without vat using default rate", () => {
    expect(calculateAmountWithVat(100)).toBe(122);
    expect(calculateAmountWithoutVat(122)).toBe(100);
  });

  it("resolves missing gross amount automatically", () => {
    expect(
      resolveVatAmounts({
        amountWithoutVat: 100,
        vatRate: DEFAULT_VAT_RATE,
      }),
    ).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 122,
      vatRate: DEFAULT_VAT_RATE,
    });
  });

  it("resolves missing net amount from gross amount", () => {
    expect(
      resolveVatAmounts({
        amountWithVat: 144,
        vatRate: 20,
      }),
    ).toEqual({
      amountWithoutVat: 120,
      amountWithVat: 144,
      vatRate: 20,
    });
  });

  it("detects auto-calculated gross amounts", () => {
    expect(matchesCalculatedAmountWithVat(100, 122, 22)).toBe(true);
    expect(matchesCalculatedAmountWithVat(100, 121, 22)).toBe(false);
  });

  it("formats amount pairs for display", () => {
    expect(
      formatAmountPair({
        amountWithoutVat: 100,
        amountWithVat: 122,
        currency: "RUB",
      }),
    ).toBe("100 RUB без НДС / 122 RUB с НДС");
  });
});
