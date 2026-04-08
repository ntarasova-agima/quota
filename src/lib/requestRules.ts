export const AI_TOOLS_FUNDING_SOURCE = "Квоты на AI-инструменты";
export const LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE = "Квота на AI-подписки";
export const INTERNAL_COSTS_FUNDING_SOURCE = "Квота на внутренние затраты";
export const PRESALES_FUNDING_SOURCE = "Квота на пресейлы";
export const PROJECT_REVENUE_FUNDING_SOURCE = "Отгрузки проекта";
export const COMPANY_PROFIT_FUNDING_SOURCE = "Прибыль компании";
export const UNKNOWN_FUNDING_SOURCE = "Я не знаю";
export const LEGACY_SERVICE_PURCHASE_CATEGORY = "Закупка сервисов";
export const SERVICE_PURCHASE_CATEGORY = "Закупки сервисов (кроме AI-инструментов)";
export const AI_TOOLS_REQUEST_CATEGORY = "AI-инструмент\\подписка";
export const CLIENT_SERVICES_TRANSIT_CATEGORY = "Сервисы/транзиты для клиентов";

export const SERVICE_PURCHASE_FUNDING_SOURCES = [
  INTERNAL_COSTS_FUNDING_SOURCE,
] as const;

const GIFT_FUNDING_SOURCES = [
  COMPANY_PROFIT_FUNDING_SOURCE,
  PRESALES_FUNDING_SOURCE,
  PROJECT_REVENUE_FUNDING_SOURCE,
] as const;

const EVENT_AND_MERCH_FUNDING_SOURCES = [
  PROJECT_REVENUE_FUNDING_SOURCE,
  COMPANY_PROFIT_FUNDING_SOURCE,
] as const;

export function normalizeFundingSource(fundingSource: string) {
  return fundingSource === LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE
    ? AI_TOOLS_FUNDING_SOURCE
    : fundingSource;
}

export function normalizeRequestCategory(category: string) {
  return category === LEGACY_SERVICE_PURCHASE_CATEGORY
    ? SERVICE_PURCHASE_CATEGORY
    : category;
}

export function isAiToolsFundingSource(fundingSource: string) {
  return normalizeFundingSource(fundingSource) === AI_TOOLS_FUNDING_SOURCE;
}

export function isAiToolsRequestCategory(category: string) {
  return normalizeRequestCategory(category) === AI_TOOLS_REQUEST_CATEGORY;
}

export function isServiceRecipientCategory(category: string) {
  return [SERVICE_PURCHASE_CATEGORY, AI_TOOLS_REQUEST_CATEGORY].includes(
    normalizeRequestCategory(category) as typeof SERVICE_PURCHASE_CATEGORY | typeof AI_TOOLS_REQUEST_CATEGORY,
  );
}

export function getDefaultFundingSourceForCategory(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  if (normalizedCategory === "Подарки") {
    return COMPANY_PROFIT_FUNDING_SOURCE;
  }
  if (["Welcome-бонус", "Конкурсное задание"].includes(normalizedCategory)) {
    return PRESALES_FUNDING_SOURCE;
  }
  if (isAiToolsRequestCategory(normalizedCategory)) {
    return AI_TOOLS_FUNDING_SOURCE;
  }
  if (normalizedCategory === SERVICE_PURCHASE_CATEGORY) {
    return INTERNAL_COSTS_FUNDING_SOURCE;
  }
  if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
    return PROJECT_REVENUE_FUNDING_SOURCE;
  }
  if (["Неформальное мероприятие", "Совместный мерч"].includes(normalizedCategory)) {
    return PROJECT_REVENUE_FUNDING_SOURCE;
  }
  return undefined;
}

export function getFundingOwnerRoles(fundingSource: string) {
  const normalizedFundingSource = normalizeFundingSource(fundingSource);
  if (normalizedFundingSource === PRESALES_FUNDING_SOURCE) {
    return ["NBD"] as const;
  }
  if (normalizedFundingSource === AI_TOOLS_FUNDING_SOURCE) {
    return ["AI-BOSS"] as const;
  }
  if (normalizedFundingSource === INTERNAL_COSTS_FUNDING_SOURCE) {
    return ["COO"] as const;
  }
  if (normalizedFundingSource === COMPANY_PROFIT_FUNDING_SOURCE) {
    return ["COO", "CFD"] as const;
  }
  return [] as const;
}

export function getEnforcedRolesForFundingSource(fundingSource: string) {
  return [...getFundingOwnerRoles(fundingSource)];
}

export function isFundingSourceAllowedForCategory(category: string, fundingSource: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  const normalizedFundingSource = normalizeFundingSource(fundingSource);
  if (normalizedFundingSource === UNKNOWN_FUNDING_SOURCE) {
    return true;
  }
  if (isAiToolsRequestCategory(normalizedCategory)) {
    return normalizedFundingSource === AI_TOOLS_FUNDING_SOURCE;
  }
  if (normalizedCategory === SERVICE_PURCHASE_CATEGORY) {
    return SERVICE_PURCHASE_FUNDING_SOURCES.includes(
      normalizedFundingSource as (typeof SERVICE_PURCHASE_FUNDING_SOURCES)[number],
    );
  }
  if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
    return normalizedFundingSource === PROJECT_REVENUE_FUNDING_SOURCE;
  }
  if (["Welcome-бонус", "Конкурсное задание"].includes(normalizedCategory)) {
    return normalizedFundingSource === PRESALES_FUNDING_SOURCE;
  }
  if (normalizedCategory === "Подарки") {
    return GIFT_FUNDING_SOURCES.includes(
      normalizedFundingSource as (typeof GIFT_FUNDING_SOURCES)[number],
    );
  }
  if (["Неформальное мероприятие", "Совместный мерч"].includes(normalizedCategory)) {
    return EVENT_AND_MERCH_FUNDING_SOURCES.includes(
      normalizedFundingSource as (typeof EVENT_AND_MERCH_FUNDING_SOURCES)[number],
    );
  }
  if (normalizedFundingSource === AI_TOOLS_FUNDING_SOURCE) {
    return false;
  }
  return true;
}
