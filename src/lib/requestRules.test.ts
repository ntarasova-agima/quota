import { describe, expect, it } from "vitest";
import {
  AI_TOOLS_FUNDING_SOURCE,
  AI_TOOLS_REQUEST_CATEGORY,
  COMPANY_PROFIT_FUNDING_SOURCE,
  INTERNAL_COSTS_FUNDING_SOURCE,
  LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE,
  PRESALES_FUNDING_SOURCE,
  SERVICE_PURCHASE_CATEGORY,
  getDefaultFundingSourceForCategory,
  getEnforcedRolesForFundingSource,
  getFundingOwnerRoles,
  isAiToolsFundingSource,
  isAiToolsRequestCategory,
  isFundingSourceAllowedForCategory,
  isServiceRecipientCategory,
  normalizeFundingSource,
} from "./requestRules";

describe("requestRules", () => {
  it("normalizes legacy ai subscription funding source", () => {
    expect(normalizeFundingSource(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toBe(AI_TOOLS_FUNDING_SOURCE);
    expect(isAiToolsFundingSource(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toBe(true);
  });

  it("returns enforced roles for funding sources", () => {
    expect(getEnforcedRolesForFundingSource(PRESALES_FUNDING_SOURCE)).toEqual(["NBD"]);
    expect(getEnforcedRolesForFundingSource(AI_TOOLS_FUNDING_SOURCE)).toEqual(["AI-BOSS"]);
    expect(getEnforcedRolesForFundingSource(INTERNAL_COSTS_FUNDING_SOURCE)).toEqual(["COO"]);
    expect(getEnforcedRolesForFundingSource(COMPANY_PROFIT_FUNDING_SOURCE)).toEqual(["COO", "CFD"]);
  });

  it("returns funding owner roles consistently", () => {
    expect(getFundingOwnerRoles(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toEqual(["AI-BOSS"]);
  });

  it("validates service purchase funding sources", () => {
    expect(isFundingSourceAllowedForCategory(SERVICE_PURCHASE_CATEGORY, INTERNAL_COSTS_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(SERVICE_PURCHASE_CATEGORY, AI_TOOLS_FUNDING_SOURCE)).toBe(false);
    expect(isFundingSourceAllowedForCategory(SERVICE_PURCHASE_CATEGORY, PRESALES_FUNDING_SOURCE)).toBe(false);
  });

  it("validates ai tools request funding sources", () => {
    expect(isFundingSourceAllowedForCategory(AI_TOOLS_REQUEST_CATEGORY, AI_TOOLS_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(AI_TOOLS_REQUEST_CATEGORY, INTERNAL_COSTS_FUNDING_SOURCE)).toBe(false);
    expect(isFundingSourceAllowedForCategory("Подарки", AI_TOOLS_FUNDING_SOURCE)).toBe(false);
  });

  it("returns default funding sources for service categories", () => {
    expect(getDefaultFundingSourceForCategory(SERVICE_PURCHASE_CATEGORY)).toBe(INTERNAL_COSTS_FUNDING_SOURCE);
    expect(getDefaultFundingSourceForCategory(AI_TOOLS_REQUEST_CATEGORY)).toBe(AI_TOOLS_FUNDING_SOURCE);
    expect(getDefaultFundingSourceForCategory("Подарки")).toBeUndefined();
  });

  it("recognizes service recipient categories", () => {
    expect(isServiceRecipientCategory(SERVICE_PURCHASE_CATEGORY)).toBe(true);
    expect(isServiceRecipientCategory(AI_TOOLS_REQUEST_CATEGORY)).toBe(true);
    expect(isServiceRecipientCategory("Подарки")).toBe(false);
    expect(isAiToolsRequestCategory(AI_TOOLS_REQUEST_CATEGORY)).toBe(true);
    expect(isAiToolsRequestCategory(SERVICE_PURCHASE_CATEGORY)).toBe(false);
  });

  it("blocks project revenue for forbidden categories", () => {
    expect(isFundingSourceAllowedForCategory("Welcome-бонус", "Отгрузки проекта")).toBe(false);
    expect(isFundingSourceAllowedForCategory("Конкурсное задание", "Отгрузки проекта")).toBe(false);
    expect(isFundingSourceAllowedForCategory("Подарки", "Отгрузки проекта")).toBe(true);
  });
});
