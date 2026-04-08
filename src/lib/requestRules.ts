export const AI_TOOLS_FUNDING_SOURCE = "Квоты на AI-инструменты";
export const LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE = "Квота на AI-подписки";
export const INTERNAL_COSTS_FUNDING_SOURCE = "Квота на внутренние затраты";
export const PRESALES_FUNDING_SOURCE = "Квота на пресейлы";
export const PROJECT_REVENUE_FUNDING_SOURCE = "Отгрузки проекта";
export const COMPANY_PROFIT_FUNDING_SOURCE = "Прибыль компании";
export const SERVICE_PURCHASE_CATEGORY = "Закупка сервисов";
export const AI_TOOLS_REQUEST_CATEGORY = "AI-инструмент\\подписка";

export const SERVICE_PURCHASE_FUNDING_SOURCES = [
  INTERNAL_COSTS_FUNDING_SOURCE,
] as const;

export function normalizeFundingSource(fundingSource: string) {
  return fundingSource === LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE
    ? AI_TOOLS_FUNDING_SOURCE
    : fundingSource;
}

export function isAiToolsFundingSource(fundingSource: string) {
  return normalizeFundingSource(fundingSource) === AI_TOOLS_FUNDING_SOURCE;
}

export function isAiToolsRequestCategory(category: string) {
  return category === AI_TOOLS_REQUEST_CATEGORY;
}

export function isServiceRecipientCategory(category: string) {
  return [SERVICE_PURCHASE_CATEGORY, AI_TOOLS_REQUEST_CATEGORY].includes(
    category as typeof SERVICE_PURCHASE_CATEGORY | typeof AI_TOOLS_REQUEST_CATEGORY,
  );
}

export function getDefaultFundingSourceForCategory(category: string) {
  if (isAiToolsRequestCategory(category)) {
    return AI_TOOLS_FUNDING_SOURCE;
  }
  if (category === SERVICE_PURCHASE_CATEGORY) {
    return INTERNAL_COSTS_FUNDING_SOURCE;
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
  const normalizedFundingSource = normalizeFundingSource(fundingSource);
  if (isAiToolsRequestCategory(category)) {
    return normalizedFundingSource === AI_TOOLS_FUNDING_SOURCE;
  }
  if (category === SERVICE_PURCHASE_CATEGORY) {
    return SERVICE_PURCHASE_FUNDING_SOURCES.includes(
      normalizedFundingSource as (typeof SERVICE_PURCHASE_FUNDING_SOURCES)[number],
    );
  }
  if (normalizedFundingSource === AI_TOOLS_FUNDING_SOURCE) {
    return false;
  }
  if (
    normalizedFundingSource === PROJECT_REVENUE_FUNDING_SOURCE &&
    ["Welcome-бонус", "Конкурсное задание"].includes(category)
  ) {
    return false;
  }
  return true;
}
