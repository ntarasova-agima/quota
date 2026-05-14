import { describe, expect, it } from "vitest";
import {
  AGIMA_QUOTAS_FUNDING_SOURCE,
  AI_TOOLS_FUNDING_SOURCE,
  AI_TOOLS_REQUEST_CATEGORY,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE,
  LEGACY_EXTENDED_SERVICE_PURCHASE_CATEGORY,
  LEGACY_PROJECT_TRANSIT_CATEGORY,
  LEGACY_SERVICE_PURCHASE_CATEGORY,
  PRESALES_FUNDING_SOURCE,
  PROJECT_REVENUE_FUNDING_SOURCE,
  PURCHASE_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  TRANSIT_TAG_NAME,
  UNKNOWN_FUNDING_SOURCE,
  getCategoriesForDepartment,
  getDefaultFundingSourceForCategory,
  getEnforcedRolesForFundingSource,
  getFundingOwnerRoles,
  getRequestAreaForCategory,
  getRequestAreaForDepartment,
  isAiToolsFundingSource,
  isAiToolsRequestCategory,
  isCategoryAllowedForDepartment,
  isFundingSourceAllowedForCategory,
  isServiceRecipientCategory,
  normalizeFundingSource,
  normalizeRequestCategory,
  shouldSkipQuotaByTag,
  usesServiceRecipientLabel,
} from "./requestRules";

describe("requestRules", () => {
  it("normalizes legacy quota sources into AGIMA quotas", () => {
    expect(normalizeFundingSource(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(normalizeFundingSource(AI_TOOLS_FUNDING_SOURCE)).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(normalizeFundingSource(PRESALES_FUNDING_SOURCE)).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(isAiToolsFundingSource(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toBe(true);
  });

  it("normalizes legacy categories into the new department matrix", () => {
    expect(normalizeRequestCategory(LEGACY_SERVICE_PURCHASE_CATEGORY)).toBe(PURCHASE_CATEGORY);
    expect(normalizeRequestCategory(LEGACY_EXTENDED_SERVICE_PURCHASE_CATEGORY)).toBe(PURCHASE_CATEGORY);
    expect(normalizeRequestCategory(SERVICE_PURCHASE_CATEGORY)).toBe(PURCHASE_CATEGORY);
    expect(normalizeRequestCategory(AI_TOOLS_REQUEST_CATEGORY)).toBe(PURCHASE_CATEGORY);
    expect(normalizeRequestCategory(LEGACY_PROJECT_TRANSIT_CATEGORY)).toBe(CLIENT_SERVICES_TRANSIT_CATEGORY);
  });

  it("does not enforce approver roles from funding source", () => {
    expect(getEnforcedRolesForFundingSource(AGIMA_QUOTAS_FUNDING_SOURCE)).toEqual([]);
    expect(getEnforcedRolesForFundingSource(PROJECT_REVENUE_FUNDING_SOURCE)).toEqual([]);
    expect(getFundingOwnerRoles(LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE)).toEqual([]);
  });

  it("returns categories by department", () => {
    expect(getCategoriesForDepartment("Аккаунтинг")).toContain("Подарки");
    expect(getCategoriesForDepartment("Аккаунтинг")).toContain(PURCHASE_CATEGORY);
    expect(getCategoriesForDepartment("Аккаунтинг")).toContain(CLIENT_SERVICES_TRANSIT_CATEGORY);
    expect(getCategoriesForDepartment("Разработка")).toEqual([PURCHASE_CATEGORY, CLIENT_SERVICES_TRANSIT_CATEGORY]);
  });

  it("checks category availability by department", () => {
    expect(isCategoryAllowedForDepartment("Подарки", "Аккаунтинг")).toBe(true);
    expect(isCategoryAllowedForDepartment(CLIENT_SERVICES_TRANSIT_CATEGORY, "Аккаунтинг")).toBe(true);
    expect(isCategoryAllowedForDepartment(CLIENT_SERVICES_TRANSIT_CATEGORY, "Разработка")).toBe(true);
    expect(isCategoryAllowedForDepartment(PURCHASE_CATEGORY, "Разработка")).toBe(true);
    expect(isCategoryAllowedForDepartment("Подарки", "Разработка")).toBe(false);
  });

  it("keeps request area helpers compatible with legacy consumers", () => {
    expect(getRequestAreaForCategory(CLIENT_SERVICES_TRANSIT_CATEGORY)).toBe("Аккаунтинг");
    expect(getRequestAreaForCategory("Подарки")).toBe("Аккаунтинг");
    expect(getRequestAreaForDepartment("Аккаунтинг")).toBe("Аккаунтинг");
    expect(getRequestAreaForDepartment("Разработка")).toBe("Администрация");
  });

  it("validates the new funding sources", () => {
    expect(isFundingSourceAllowedForCategory(PURCHASE_CATEGORY, AGIMA_QUOTAS_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(PURCHASE_CATEGORY, PROJECT_REVENUE_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(PURCHASE_CATEGORY, UNKNOWN_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(CLIENT_SERVICES_TRANSIT_CATEGORY, PROJECT_REVENUE_FUNDING_SOURCE)).toBe(true);
    expect(isFundingSourceAllowedForCategory(CLIENT_SERVICES_TRANSIT_CATEGORY, AGIMA_QUOTAS_FUNDING_SOURCE)).toBe(false);
  });

  it("returns new default funding sources", () => {
    expect(getDefaultFundingSourceForCategory("Welcome-бонус")).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(getDefaultFundingSourceForCategory("Подарки")).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(getDefaultFundingSourceForCategory(PURCHASE_CATEGORY)).toBe(AGIMA_QUOTAS_FUNDING_SOURCE);
    expect(getDefaultFundingSourceForCategory(CLIENT_SERVICES_TRANSIT_CATEGORY)).toBe(PROJECT_REVENUE_FUNDING_SOURCE);
  });

  it("recognizes service recipient and legacy AI categories", () => {
    expect(isServiceRecipientCategory(PURCHASE_CATEGORY)).toBe(false);
    expect(usesServiceRecipientLabel(PURCHASE_CATEGORY)).toBe(true);
    expect(isServiceRecipientCategory(LEGACY_SERVICE_PURCHASE_CATEGORY)).toBe(true);
    expect(isServiceRecipientCategory(CLIENT_SERVICES_TRANSIT_CATEGORY)).toBe(false);
    expect(usesServiceRecipientLabel(CLIENT_SERVICES_TRANSIT_CATEGORY)).toBe(false);
    expect(isAiToolsRequestCategory(AI_TOOLS_REQUEST_CATEGORY)).toBe(true);
    expect(isAiToolsRequestCategory(PURCHASE_CATEGORY)).toBe(false);
  });

  it("skips quota usage for the Transit tag", () => {
    expect(shouldSkipQuotaByTag(TRANSIT_TAG_NAME)).toBe(true);
    expect(shouldSkipQuotaByTag("Тендер")).toBe(false);
  });
});
