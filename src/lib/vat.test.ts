import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAT_RATE,
  calculateAmountWithVat,
  calculateAmountWithoutVat,
  fillMissingVatAmounts,
  formatAmountPair,
  matchesCalculatedAmountWithVat,
  parseMoneyInput,
  parseVatRateInput,
  resolveVatAmounts,
  syncVatInputPair,
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

  it("fills only the missing amount when auto calculation is requested", () => {
    expect(
      resolveVatAmounts({
        amountWithoutVat: 100,
        amountWithVat: 140,
        vatRate: DEFAULT_VAT_RATE,
        autoCalculateAmountWithVat: true,
      }),
    ).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 140,
      vatRate: DEFAULT_VAT_RATE,
    });
  });

  it("fills the blank side of the pair in either direction", () => {
    expect(
      fillMissingVatAmounts({
        amountWithoutVat: 100,
        vatRate: 20,
      }),
    ).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 120,
    });
    expect(
      fillMissingVatAmounts({
        amountWithVat: 120,
        vatRate: 20,
      }),
    ).toEqual({
      amountWithoutVat: 100,
      amountWithVat: 120,
    });
  });

  it("detects auto-calculated gross amounts", () => {
    expect(matchesCalculatedAmountWithVat(100, 122, 22)).toBe(true);
    expect(matchesCalculatedAmountWithVat(100, 121, 22)).toBe(false);
  });

  it("parses empty vat rate as zero and money strings as numbers", () => {
    expect(parseVatRateInput("")).toBe(0);
    expect(parseVatRateInput(" 18 ")).toBe(18);
    expect(parseMoneyInput(" 12 345.67 ")).toBe(12345.67);
    expect(parseMoneyInput("")).toBeUndefined();
  });

  it("syncs amount inputs from the edited side", () => {
    expect(
      syncVatInputPair({
        amountWithoutVatInput: "100",
        amountWithVatInput: "",
        vatRateInput: "20",
        source: "without",
      }),
    ).toEqual({
      amountWithoutVatInput: "100",
      amountWithVatInput: "120",
    });
    expect(
      syncVatInputPair({
        amountWithoutVatInput: "",
        amountWithVatInput: "120",
        vatRateInput: "20",
        source: "with",
      }),
    ).toEqual({
      amountWithoutVatInput: "100",
      amountWithVatInput: "120",
    });
    expect(
      syncVatInputPair({
        amountWithoutVatInput: "100",
        amountWithVatInput: "122",
        vatRateInput: "",
        source: "without",
      }),
    ).toEqual({
      amountWithoutVatInput: "100",
      amountWithVatInput: "100",
    });
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
